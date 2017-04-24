'use strict'

const aws = require('aws-sdk') // eslint-disable-line import/no-unresolved, import/no-extraneous-dependencies
const KH = require('kinesis-handler')

// TODO Get these from a better place later
const eventSchema = require('./retail-stream-schema-egress.json')
const productCreateSchema = require('./product-create-schema.json')
const productImageSchema = require('./product-image-schema.json')
const productPurchaseSchema = require('./product-purchase-schema.json')

const constants = {
  // self
  MODULE: 'winner-view/winner.js',
  NONE: 'NONE',
  // methods
  METHOD_REGISTER_CONTRIBUTOR: 'registerContributor',
  METHOD_UPDATE_SCORES_TABLES: 'updateScoresTable',
  METHOD_GET_EVENTS_THEN_CREDIT: 'getEventsThenCredit',
  METHOD_CREDIT_CONTRIBUTIONS: 'creditContributions',
  METHOD_UPDATE_PURCHASE_EVENT: 'updatePurchaseEvent',
  // resources
  TABLE_CONTRIBUTIONS_NAME: process.env.TABLE_CONTRIBUTIONS_NAME,
  TABLE_SCORES_NAME: process.env.TABLE_SCORES_NAME,
  TABLE_EVENTS_NAME: process.env.TABLE_EVENTS_NAME,
}

const kh = new KH.KinesisSynchronousHandler(eventSchema, constants.MODULE)

const dynamo = new aws.DynamoDB.DocumentClient()

const impl = {
  /**
   * Register creator or photographer to contributions tables.  Example event (for creator):
   * {
   *   "schema": "com.nordstrom/retail-stream-egress/1-0-0",
   *   "origin": "hello-retail/product-producer-creator/uniqueId/friendlyName",
   *   "timeOrigin": "2017-03-28T23:29:23.160Z",
   *   "data": {
   *     "schema": "com.nordstrom/product/create/1-0-0",
   *     "id": "4579874",
   *     "brand": "POLO RALPH LAUREN",
   *     "name": "Polo Ralph Lauren 3-Pack Socks",
   *     "description": "PAGE:/s/polo-ralph-lauren-3-pack-socks/4579874",
   *     "category": "Socks for Men"
   *   },
   *   "eventId":"shardId-000000000002:49571669009522853278119462494300940056686602130905104418",
   *   "timeIngest":"2017-03-28T23:29:23.262Z",
   *   "timeProcess":"2017-03-28T23:29:29.720Z"
   * }
   * @param role Either photographer or creator role
   * @param event Either a product/create or a product/image event.
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  registerContributor: (role, event, complete) => {
    const updated = Date.now()

    const updateCallback = (err) => {
      if (err) {
        complete(`${constants.METHOD_REGISTER_CONTRIBUTOR} - errors updating DynamoDb: ${err}`)
      } else {
        const roleInfo = {}
        roleInfo[role] = event.origin
        impl.getEventsThenCredit(event.data.id, event.eventId, event.origin, roleInfo, complete)
      }
    }

    // Record product's contributor registration
    const expression = [
      'set',
      '#c=if_not_exists(#c,:c),',
      '#cb=if_not_exists(#cb,:cb),',
      '#u=:u,',
      '#ub=:ub,',
      '#ro=if_not_exists(#ro,:ro),',
      '#ev=if_not_exists(#ev,:ev)',
    ]
    const attNames = {
      '#c': 'created',
      '#cb': 'createdBy',
      '#u': 'updated',
      '#ub': 'updatedBy',
      '#ro': role,
      '#ev': `${role}EventId`,
    }
    const attValues = {
      ':c': updated,
      ':cb': event.origin,
      ':u': updated,
      ':ub': event.origin,
      ':ro': event.origin,
      ':ev': event.eventId,
    }

    const dbParamsContributions = {
      TableName: constants.TABLE_CONTRIBUTIONS_NAME,
      Key: {
        productId: event.data.id,
      },
      UpdateExpression: expression.join(' '),
      ExpressionAttributeNames: attNames,
      ExpressionAttributeValues: attValues,
      ReturnValues: constants.NONE,
      ReturnConsumedCapacity: constants.NONE,
      ReturnItemCollectionMetrics: constants.NONE,
    }
    dynamo.update(dbParamsContributions, updateCallback)
  },
  /**
   * Get events from the Events table that will need to have the contributor attached to them.
   * @param id The product id
   * @param origin Who/what triggered this update
   * @param roleInfo Who was the photographer or creator for this product
   * @param baseline The eventId that first registered the contributor, so credit is only applied subsequently.
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  getEventsThenCredit: (id, baseline, origin, roleInfo, complete) => {
    const params = {
      TableName: constants.TABLE_EVENTS_NAME,
      ProjectionExpression: '#e',
      KeyConditionExpression: '#i = :i AND #e > :e',
      ExpressionAttributeNames: {
        '#i': 'productId',
        '#e': 'eventId',
      },
      ExpressionAttributeValues: {
        ':i': id,
        ':e': baseline,
      },
    }

    dynamo.query(params, (err, data) => {
      if (err) {
        complete(`${constants.METHOD_GET_EVENTS_THEN_CREDIT} - errors updating DynamoDb: ${err}`)
      } else if (!data || !data.Items || data.Items.length === 0) {
        console.log(`Found no events already logged for ${id}, but occurring after the registration event ${baseline}.`) // TODO remove
        complete()
      } else {
        console.log('Found later events that were already logged, needing contributor added ', data.Items) // TODO remove
        impl.creditContributions(id, data.Items.map(item => item.eventId), origin, roleInfo, complete)
      }
    })
  },
  /**
   * Assign credit to a product-event pair in the Events table, either because of a purchase event or to true up any
   * events we may have seen prior to the registration due to the batch being out of order.  If there is no one to
   * credit, just log the product-event id.
   * @param id The product id
   * @param origin Who/what triggered this update
   * @param roleInfo Who was the photographer or creator for this product
   * @param eventIds Array of event ids for that product needing credit entered into the Events table. Note that there
   * is either both a photographer and a creator, in which case eventIds is length 1, or it is a bunch of events for a
   * single registration of either a creator or a photographer (but not both).  Expect one or small size generally.
   * Credit should only be assigned if the contributor registered prior to the purchase event, as reflected by the fact
   * the event Id is further along in the sequence for that product than the registration event; the eventIds should
   * reflect this.
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  creditContributions: (id, eventIds, origin, roleInfo, complete) => {
    const updated = Date.now()

    // Record contributor info for specific event.
    const expression = [
      'set',
      '#c=if_not_exists(#c,:c),',
      '#cb=if_not_exists(#cb,:cb),',
      '#u=:u,',
      '#ub=:ub',
    ]
    const attNames = {
      '#c': 'created',
      '#cb': 'createdBy',
      '#u': 'updated',
      '#ub': 'updatedBy',
    }
    const attValues = {
      ':c': updated,
      ':cb': origin,
      ':u': updated,
      ':ub': origin,
    }

    if (roleInfo) {
      if (roleInfo.creator) {
        expression.push(', #cr=:cr')
        attNames['#cr'] = 'creator'
        attValues[':cr'] = roleInfo.creator
      }
      if (roleInfo.photographer) {
        expression.push(', #ph=:ph')
        attNames['#ph'] = 'photographer'
        attValues[':ph'] = roleInfo.photographer
      }
    } else {
      console.log(`${constants.METHOD_CREDIT_CONTRIBUTIONS} No contributors passed, so just logging event.`) // TODO remove
    }

    let successes = 0
    const groupDynamoCallback = (err) => {
      if (err) {
        complete(`${constants.METHOD_CREDIT_CONTRIBUTIONS} - errors updating DynamoDb: ${err}`)
      } else {
        successes += 1
      }
      if (successes === eventIds.length) {
        console.log(`${constants.MODULE} ${constants.METHOD_CREDIT_CONTRIBUTIONS} - all ${eventIds.length} events updated successfully for ${id}.`)
        impl.updateScoresTable(origin, roleInfo, complete)
      }
    }
    for (let i = 0; i < eventIds.length; i++) {
      const dbParamsEvents = {
        TableName: constants.TABLE_EVENTS_NAME,
        Key: {
          productId: id,
          eventId: eventIds[i],
        },
        UpdateExpression: expression.join(' '),
        ExpressionAttributeNames: attNames,
        ExpressionAttributeValues: attValues,
        ReturnValues: constants.NONE,
        ReturnConsumedCapacity: constants.NONE,
        ReturnItemCollectionMetrics: constants.NONE,
      }
      dynamo.update(dbParamsEvents, groupDynamoCallback)
    }
  },
  /**
   * Update scores table on whatever contributor(s) were just affected.
   * @param data Who to update that was affected by last update of creator and/or photographer.
   * @param origin Who/what generated the activity leading to this update
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  updateScoresTable: (origin, data, complete) => {
    const updated = Date.now()

    let priorErr
    const updateCallback = (err) => {
      if (priorErr === undefined) { // first update result
        if (err) {
          priorErr = err
        } else {
          priorErr = false
        }
      } else if (priorErr && err) { // second update result, if an error was previously received and we have a new one
        complete(`${constants.METHOD_UPDATE_SCORES_TABLES} - errors updating DynamoDb: ${[priorErr, err]}`)
      } else if (priorErr || err) {
        complete(`${constants.METHOD_UPDATE_SCORES_TABLES} - error updating DynamoDb: ${priorErr || err}`)
      } else { // second update result if error was not previously seen.
        complete()
      }
    }
    if (!data || (!data.creator && !data.photographer)) {
      console.log('No contributor information on that update, so no effect on scores.')
      // TODO could log this to an UNKNOWN contributor for both
      complete()
    } else {
      const updateExp = [
        'set',
        '#u=:u,',
        '#ub=:ub,',
        '#sc=:sc',
      ].join(' ')
      const attNames = {
        '#u': 'updated',
        '#ub': 'updatedBy',
        '#sc': 'score',
      }
      const attValues = {
        ':u': updated,
        ':ub': origin,
      }
      if (data.creator) {
        const params = {
          TableName: constants.TABLE_EVENTS_NAME,
          IndexName: 'EventsByCreator',
          ProjectionExpression: '#i, #e', // TODO remove after removing console.log
          KeyConditionExpression: '#cr = :cr',
          ExpressionAttributeNames: {
            '#i': 'productId', // TODO remove after removing console.log
            '#e': 'eventId', // TODO remove after removing console.log
            '#cr': 'creator',
          },
          ExpressionAttributeValues: {
            ':cr': data.creator,
          },
        }

        dynamo.query(params, (err, response) => {
          if (err) { // error from dynamo
            updateCallback(`${constants.METHOD_UPDATE_SCORES_TABLES} - errors getting records from GSI Creator DynamoDb: ${err}`)
          } else {
            console.log('Found creator pairs ', response.Items) // TODO remove
            const attValuesCreator = Object.assign({}, attValues)
            attValuesCreator[':sc'] = response.Count
            const dbParamsCreator = {
              TableName: constants.TABLE_SCORES_NAME,
              Key: {
                userId: data.creator,
                role: 'creator',
              },
              UpdateExpression: updateExp,
              ExpressionAttributeNames: attNames,
              ExpressionAttributeValues: attValuesCreator,
              ReturnValues: constants.NONE,
              ReturnConsumedCapacity: constants.NONE,
              ReturnItemCollectionMetrics: constants.NONE,
            }
            dynamo.update(dbParamsCreator, updateCallback)
          }
        })
      } else { // TODO could log this to an UNKNOWN contributor instead
        updateCallback()
      }
      if (data.photographer) {
        const params = {
          TableName: constants.TABLE_EVENTS_NAME,
          IndexName: 'EventsByPhotographer',
          ProjectionExpression: '#i, #e', // TODO remove after removing console.log
          KeyConditionExpression: '#ph = :ph',
          ExpressionAttributeNames: {
            '#i': 'productId', // TODO remove after removing console.log
            '#e': 'eventId', // TODO remove after removing console.log
            '#ph': 'photographer',
          },
          ExpressionAttributeValues: {
            ':ph': data.photographer,
          },
        }

        dynamo.query(params, (err, response) => {
          if (err) { // error from dynamo
            updateCallback(`${constants.METHOD_UPDATE_SCORES_TABLES} - errors getting records from GSI Photographer DynamoDb: ${err}`)
          } else {
            console.log('Found photographer pairs ', response.Items) // TODO remove
            const attValuesPhotographer = Object.assign({}, attValues)
            attValuesPhotographer[':sc'] = response.Count
            const dbParamsPhotographer = {
              TableName: constants.TABLE_SCORES_NAME,
              Key: {
                userId: data.photographer,
                role: 'photographer',
              },
              UpdateExpression: updateExp,
              ExpressionAttributeNames: attNames,
              ExpressionAttributeValues: attValuesPhotographer,
              ReturnValues: constants.NONE,
              ReturnConsumedCapacity: constants.NONE,
              ReturnItemCollectionMetrics: constants.NONE,
            }
            dynamo.update(dbParamsPhotographer, updateCallback)
          }
        })
      } else { // TODO could log this to an UNKNOWN contributor instead
        updateCallback()
      }
    }
  },
  /**
   * Log latest purchase of a given product id to the Events table.  Example event:
   * {
   *   "schema":"com.nordstrom/retail-stream-egress/1-0-0",
   *   "timeOrigin":"2017-03-28T23:52:53.763Z",
   *   "data":{
   *      "schema":"com.nordstrom/product/purchase/1-0-0",
   *      "id":"7749361"
   *   },
   *   "origin":"hello-retail/web-client-purchase-product/uniqueId/friendlyName",
   *   "eventId":"shardId-000000000001:49571669109051079099161633575187621651768511161306185746",
   *   "timeIngest":"2017-03-28T23:52:53.818Z",
   *   "timeProcess":"2017-03-28T23:52:59.677Z"
   * },
   * @param event The event that is currently being processed.
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  updatePurchaseEvent: (event, complete) => {
    const dbParamsContributions = {
      Key: {
        productId: event.data.id,
      },
      TableName: constants.TABLE_CONTRIBUTIONS_NAME,
      AttributesToGet: [
        'creator',
        'creatorEventId',
        'photographer',
        'photographerEventId',
      ],
      ConsistentRead: false,
      ReturnConsumedCapacity: constants.NONE,
    }
    dynamo.get(dbParamsContributions, (err, data) => {
      if (err) {
        complete(`${constants.METHOD_UPDATE_PURCHASE_EVENT} - errors getting product ${event.data.id} from DynamoDb table ${constants.TABLE_CONTRIBUTIONS_NAME}: ${err}`)
      } else {
        const roleInfo = {}
        if (data && data.Item) {
          if (data.Item.creator && data.Item.creatorEventId && event.eventId > data.Item.creatorEventId) {
            roleInfo.creator = data.Item.creator
          }
          if (data.Item.photographer && data.Item.photographerEventId && event.eventId > data.Item.photographerEventId) {
            roleInfo.photographer = data.Item.photographer
          }
        }
        impl.creditContributions(event.data.id, [event.eventId], event.origin, roleInfo, complete)
      }
    })
  },
}

kh.registerSchemaMethodPair(productCreateSchema, impl.registerContributor.bind(null, 'creator'))
kh.registerSchemaMethodPair(productImageSchema, impl.registerContributor.bind(null, 'photographer'))
kh.registerSchemaMethodPair(productPurchaseSchema, impl.updatePurchaseEvent)

module.exports = {
  processKinesisEvent: kh.processKinesisEvent.bind(kh),
}

console.log(`${constants.MODULE} - CONST: ${JSON.stringify(constants, null, 2)}`)
console.log(`${constants.MODULE} - ENV:   ${JSON.stringify(process.env, null, 2)}`)
