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
  UNKNOWN: 'UNKNOWN',
  // methods
  METHOD_REGISTER_CONTRIBUTOR: 'registerContributor',
  METHOD_UPDATE_SCORES_TABLES: 'updateScoresTable',
  METHOD_UPDATE_PURCHASE_EVENT: 'updatePurchaseEvent',
  // resources
  TABLE_CONTRIBUTIONS_NAME: process.env.TABLE_CONTRIBUTIONS_NAME,
  TABLE_SCORES_NAME: process.env.TABLE_SCORES_NAME,
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
        complete()
      }
    }

    // Note if someone manually re-registers as the contributor later, it gets ignored and credit continues to accumulate to the original contributor (until we explicitly support re-shoots as a feature).
    const expression = [
      'set',
      '#c=if_not_exists(#c,:c),',
      '#cb=if_not_exists(#cb,:cb),',
      '#u=:u,',
      '#ub=:ub,',
      '#ro=if_not_exists(#ro,:ro),', // We shouldn't have to block overwrites, because order guarantee should mean registration event will always come first and nature of hello-retail should not have any way to change a creator or photographer, once registered, BUT just saw this happen with photographers because someone went in and reset by hand.  Until we have re-shoots be a feature, all credit still goes to original contributor.
      '#sc=if_not_exists(#sc,:zero),', // Score initializes at 0.  If this was an attempt to put in new contributor, then that gets blocked (no overwrites of contributors), so score should not reset to 0 (unless we later make re-shoots a feature).
      '#ev=:ev',
    ]
    const attNames = {
      '#c': 'created',
      '#cb': 'createdBy',
      '#u': 'updated',
      '#ub': 'updatedBy',
      '#ro': role,
      '#sc': `${role}Score`, // These scores may be different for the two roles because some purchases may happen between the time that the creator and photographer registered.  Each score should be initialized only its registration event.
      '#ev': 'lastEventId',
      '#pe': 'photographerExists',
    }
    const attValues = {
      ':c': updated,
      ':cb': event.origin,
      ':u': updated,
      ':ub': event.origin,
      ':ro': event.origin,
      ':ev': event.eventId,
      ':zero': 0,
    }

    if (role === 'creator') {
      attNames['#sp'] = 'photographerScore'
      expression.push(', #sp=if_not_exists(#sp,:zero)') // To keep if_not_exists from blowing up, this must be defined before any purchase events happen
      expression.push(', #pe=:pe')
      attValues[':pe'] = -1
    } else if (role === 'photographer') { // NB if there was no creation event but the photographer event made it on, the photographer should still be UNKNOWN, because the score has been accumulating as if he were UNKNOWN, but there is no easy way to overwrite the name with UNKNOWN if one pass, so will handle this when updatingScores instead.  Basically, if you see UNKNOWN in the creator field, ignore the person who is in the photographer field, if any.
      attNames['#scr'] = 'creatorScore'
      attNames['#cr'] = 'creator'
      attValues[':unk'] = constants.UNKNOWN
      expression.push(', #scr=if_not_exists(#scr,:zero)')
      expression.push(', #cr=if_not_exists(#cr,:unk)') // To block any creator attribution for events without a creation event (i.e., log incomplete from the front for product)
      expression.push('remove #pe') // REMOVE: If the attributes do not exist, nothing happens
    }

    const dbParamsContributions = {
      TableName: constants.TABLE_CONTRIBUTIONS_NAME,
      Key: {
        productId: event.data.id,
      },
      UpdateExpression: expression.join(' '),
      ExpressionAttributeNames: attNames,
      ExpressionAttributeValues: attValues,
      ReturnValues: 'NONE',
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
    }
    dynamo.update(dbParamsContributions, updateCallback)
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
    const id = event.data.id
    const eventId = event.eventId
    const origin = event.origin
    const updated = Date.now()

    // We should know at least one contributor exists, because order guarantee says that the creation event had to have happened already, but sadly, it might get trimmed off.  To keep things simple, for products without a creation event we will attribute everything to UNKNOWN for the photographer, too (even if that makes it onto the stream).
    const expression = [
      'set',
      '#c=if_not_exists(#c,:c),', // if_not_exists evaluates to the path (first argument) if the path exists in the item, otherwise it evaluates to the operand (second argument)
      '#cb=if_not_exists(#cb,:cb),',
      '#u=:u,',
      '#ub=:ub,',
      '#sc=if_not_exists(#sc,:zero) + :inc,', // Shouldn't need to check if this exist because order guarantee says this already will be there, but if the creation event got trimmed off, then we'll still fail trying to add 1 to a nonexistent value.  No creator will get the credit, just UNKNOWN.
      '#sp=if_not_exists(#pe,if_not_exists(#sp,:zero)) + :inc,', // Only increment this if a creation event was logged and a photographer registers (which removes the #pe attribute) or if no creation event was logged in the first place, in which latter case it doesn't matter, because the number goes to UNKNOWN.
      '#ro=if_not_exists(#ro,:unk),', // Note that if the creator got chopped off the front of the stream, we need to attribute the purchase to UNKNOWN.  If we were sure no manual creation event got lobbed on later, we could maybe just rely on emptiness, but we need this to be consistent with the idea (in registerContributor) that manual events are blocked from changing who gets credit (until we make this a feature).
      '#ev=:ev',
    ]
    const attNames = {
      '#c': 'created',
      '#cb': 'createdBy',
      '#u': 'updated',
      '#ub': 'updatedBy',
      '#sc': 'creatorScore', // These may be different for the two roles because some purchases may happen between the time that the creator and photographer registered
      '#sp': 'photographerScore',
      '#pe': 'photographerExists', // For the conditional on whether photographer exists yet
      '#ev': 'lastEventId',
      '#ro': 'creator',
    }
    const attValues = {
      ':c': updated,
      ':cb': origin,
      ':u': updated,
      ':ub': origin,
      ':inc': 1,
      ':zero': 0,
      ':ev': eventId,
      ':unk': constants.UNKNOWN,
    }
    const callback = (err) => {
      if (err) {
        if (err.code && err.code === 'ConditionalCheckFailedException') {
          console.log(`${constants.METHOD_UPDATE_PURCHASE_EVENT} - event has already been processed or creation event for product ${id} occurred before stream horizon.  Skipping.`)
          complete()
        } else {
          complete(`${constants.METHOD_UPDATE_PURCHASE_EVENT} - errors updating DynamoDb: ${err}`)
        }
      } else {
        impl.updateScoresTable(origin, id, complete)
      }
    }

    const dbParamsEvents = {
      TableName: constants.TABLE_CONTRIBUTIONS_NAME,
      Key: {
        productId: id,
      },
      UpdateExpression: expression.join(' '),
      ConditionExpression: '#ev < :ev',
      ExpressionAttributeNames: attNames,
      ExpressionAttributeValues: attValues,
      ReturnValues: 'NONE',
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
    }
    dynamo.update(dbParamsEvents, callback)
  },
  /**
   * Update scores table on whatever contributor(s) were just affected.  This is also where photographers are updated to UNKNOWN in the cases where the creation event didn't make it onto the stream.
   * @param id Which product id was affected by last purchase event.
   * @param origin Who/what generated the activity leading to this update
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  updateScoresTable: (origin, id, complete) => {
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
        complete(`${constants.METHOD_UPDATE_SCORES_TABLES} - errors updating ${constants.TABLE_SCORES_NAME} DynamoDb: ${[priorErr, err]}`)
      } else if (priorErr || err) {
        complete(`${constants.METHOD_UPDATE_SCORES_TABLES} - error updating ${constants.TABLE_SCORES_NAME} DynamoDb: ${priorErr || err}`)
      } else { // second update result if error was not previously seen.
        complete()
      }
    }

    const dbParamsContributions = {
      Key: {
        productId: id,
      },
      TableName: constants.TABLE_CONTRIBUTIONS_NAME,
      AttributesToGet: [
        'creator',
        'photographer',
      ],
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
    }
    dynamo.get(dbParamsContributions, (errBase, responseBase) => {
      if (errBase) {
        complete(`${constants.METHOD_UPDATE_SCORES_TABLES} - errors getting product ${id} from DynamoDb table ${constants.TABLE_CONTRIBUTIONS_NAME}: ${errBase}`)
      } else {
        const data = responseBase.Item
        if (!data || data.length === 0) {
          complete(`${constants.METHOD_UPDATE_SCORES_TABLES} - unexpectedly could not find product ${id} from DynamoDb table ${constants.TABLE_CONTRIBUTIONS_NAME}`)
        } else { // Sort out the creator
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

          // Because this method is only called through the occurrence of a purchase event and that must be subsequent to a creator registration or set to UNKNOWN on the very next event for lack of a creator registration, we definitely have a creator field
          const dbParamsCreator = {
            TableName: constants.TABLE_CONTRIBUTIONS_NAME,
            IndexName: 'ProductsByCreator',
            ProjectionExpression: '#i, #s', // TODO remove id after removing console.log, only need the score really
            KeyConditionExpression: '#ro = :ro',
            ExpressionAttributeNames: {
              '#i': 'productId', // TODO remove after removing console.log
              '#s': 'creatorScore',
              '#ro': 'creator',
            },
            ExpressionAttributeValues: {
              ':ro': data.creator,
            },
          }

          dynamo.query(dbParamsCreator, (err, response) => {
            if (err) { // error from dynamo
              updateCallback(`${constants.METHOD_UPDATE_SCORES_TABLES} - errors getting records from GSI Creator DynamoDb: ${err}`)
            } else {
              console.log('Found products ', response.Items) // TODO remove

              const foundScores = response.Items.map(item => item.creatorScore) // There is always a score by this point
              const attValuesCreator = Object.assign({}, attValues)
              attValuesCreator[':sc'] = foundScores.length === 0 ? 0 : foundScores.reduce((acc, val) => acc + val)

              const params = {
                TableName: constants.TABLE_SCORES_NAME,
                Key: {
                  userId: data.creator,
                  role: 'creator',
                },
                UpdateExpression: updateExp,
                ExpressionAttributeNames: attNames,
                ExpressionAttributeValues: attValuesCreator,
                ReturnValues: 'NONE',
                ReturnConsumedCapacity: 'NONE',
                ReturnItemCollectionMetrics: 'NONE',
              }
              dynamo.update(params, updateCallback)
            }
          })

          // Sort out the photographer
          if (data.creator === constants.UNKNOWN) {
            // Set photographer to UNKNOWN fo this product, then update photographer score.
            const phExp = [
              'set',
              '#c=if_not_exists(#c,:c),', // very strange of this didn't already exist
              '#cb=if_not_exists(#cb,:cb),',
              '#u=:u,',
              '#ub=:ub,',
              '#ro=:unk',
            ]
            const phAttNames = {
              '#c': 'created',
              '#cb': 'createdBy',
              '#u': 'updated',
              '#ub': 'updatedBy',
              '#ro': 'photographer',
            }
            const phAttValues = {
              ':c': updated,
              ':cb': origin,
              ':u': updated,
              ':ub': origin,
              ':unk': constants.UNKNOWN,
            }
            const phCallback = (errPhUnk) => {
              if (errPhUnk) {
                updateCallback(`${constants.METHOD_UPDATE_PURCHASE_EVENT} - errors updating Contributions DynamoDb so photographer is set to UNKNOWN: ${errPhUnk}`)
              } else {
                const dbParamsUnk = {
                  TableName: constants.TABLE_CONTRIBUTIONS_NAME,
                  IndexName: 'ProductsByPhotographer',
                  ProjectionExpression: '#i, #s', // TODO remove id after removing console.log, only need the score really
                  KeyConditionExpression: '#ro = :ro',
                  ExpressionAttributeNames: {
                    '#i': 'productId', // TODO remove after removing console.log
                    '#s': 'photographerScore',
                    '#ro': 'photographer',
                  },
                  ExpressionAttributeValues: {
                    ':ro': constants.UNKNOWN,
                  },
                }

                dynamo.query(dbParamsUnk, (err, response) => {
                  if (err) { // error from dynamo
                    updateCallback(`${constants.METHOD_UPDATE_SCORES_TABLES} - errors getting records from GSI Photographer DynamoDb for the UNKNOWN photographer: ${err}`)
                  } else {
                    console.log('Found products ', response.Items) // TODO remove

                    const foundScores = response.Items.map(item => item.photographerScore) // There is always a score by this point
                    const attValuesUnk = Object.assign({}, attValues)
                    attValuesUnk[':sc'] = foundScores.length === 0 ? 0 : foundScores.reduce((acc, val) => acc + val)

                    const params = {
                      TableName: constants.TABLE_SCORES_NAME,
                      Key: {
                        userId: constants.UNKNOWN,
                        role: 'photographer',
                      },
                      UpdateExpression: updateExp,
                      ExpressionAttributeNames: attNames,
                      ExpressionAttributeValues: attValuesUnk,
                      ReturnValues: 'NONE',
                      ReturnConsumedCapacity: 'NONE',
                      ReturnItemCollectionMetrics: 'NONE',
                    }
                    dynamo.update(params, updateCallback)
                  }
                })
              }
            }
            const dbParamsPh = {
              TableName: constants.TABLE_CONTRIBUTIONS_NAME,
              Key: {
                productId: id,
              },
              UpdateExpression: phExp.join(' '),
              ExpressionAttributeNames: phAttNames,
              ExpressionAttributeValues: phAttValues,
              ReturnValues: 'NONE',
              ReturnConsumedCapacity: 'NONE',
              ReturnItemCollectionMetrics: 'NONE',
            }
            dynamo.update(dbParamsPh, phCallback)
          } else if (data.photographer) { // This is the plain-vanilla photographer case.
            const dbParamsPhotographer = {
              TableName: constants.TABLE_CONTRIBUTIONS_NAME,
              IndexName: 'ProductsByPhotographer',
              ProjectionExpression: '#i, #s', // TODO remove id after removing console.log, only need the score really
              KeyConditionExpression: '#ro = :ro',
              ExpressionAttributeNames: {
                '#i': 'productId', // TODO remove after removing console.log
                '#s': 'photographerScore',
                '#ro': 'photographer',
              },
              ExpressionAttributeValues: {
                ':ro': data.photographer,
              },
            }

            dynamo.query(dbParamsPhotographer, (err, response) => {
              if (err) { // error from dynamo
                updateCallback(`${constants.METHOD_UPDATE_SCORES_TABLES} - errors getting records from GSI Photographer DynamoDb: ${err}`)
              } else {
                console.log('Found products ', response.Items) // TODO remove

                const foundScores = response.Items.map(item => item.photographerScore) // There is always a score by this point
                const attValuesPhotographer = Object.assign({}, attValues)
                attValuesPhotographer[':sc'] = foundScores.length === 0 ? 0 : foundScores.reduce((acc, val) => acc + val)

                const params = {
                  TableName: constants.TABLE_SCORES_NAME,
                  Key: {
                    userId: data.photographer,
                    role: 'photographer',
                  },
                  UpdateExpression: updateExp,
                  ExpressionAttributeNames: attNames,
                  ExpressionAttributeValues: attValuesPhotographer,
                  ReturnValues: 'NONE',
                  ReturnConsumedCapacity: 'NONE',
                  ReturnItemCollectionMetrics: 'NONE',
                }
                dynamo.update(params, updateCallback)
              }
            })
          } else { // Free pass, nothing to do for photographer
            updateCallback()
          }
        }
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
