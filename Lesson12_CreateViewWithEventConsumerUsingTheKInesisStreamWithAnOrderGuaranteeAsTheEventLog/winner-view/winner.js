'use strict'

const AJV = require('ajv')
const aws = require('aws-sdk') // eslint-disable-line import/no-unresolved, import/no-extraneous-dependencies

// TODO Get these from a better place later
const eventSchema = require('./retail-stream-schema-egress.json')
const productCreateSchema = require('./product-create-schema.json')
const productImageSchema = require('./product-image-schema.json')
const productPurchaseSchema = require('./product-purchase-schema.json')

// TODO generalize this?  it is used by but not specific to this module
const makeSchemaId = schema => `${schema.self.vendor}/${schema.self.name}/${schema.self.version}`

const eventSchemaId = makeSchemaId(eventSchema)
const productCreateSchemaId = makeSchemaId(productCreateSchema)
const productImageSchemaId = makeSchemaId(productImageSchema)
const productPurchaseSchemaId = makeSchemaId(productPurchaseSchema)

const ajv = new AJV()
ajv.addSchema(eventSchema, eventSchemaId)
ajv.addSchema(productCreateSchema, productCreateSchemaId)
ajv.addSchema(productImageSchema, productImageSchemaId)
ajv.addSchema(productPurchaseSchema, productPurchaseSchemaId)

const dynamo = new aws.DynamoDB.DocumentClient()

const constants = {
  // self
  MODULE: 'winner-view/winner.js',
  // methods
  METHOD_REGISTER_CONTRIBUTOR: 'registerContributor',
  METHOD_UPDATE_SCORES_TABLES: 'updateScoresTable',
  METHOD_UPDATE_PURCHASE_EVENT: 'updatePurchaseEvent',
  METHOD_PROCESS_EVENT: 'processEvent',
  METHOD_PROCESS_KINESIS_EVENT: 'processKinesisEvent',
  // errors
  BAD_MSG: 'bad msg:',
  // resources
  TABLE_CONTRIBUTIONS_NAME: process.env.TABLE_CONTRIBUTIONS_NAME,
  TABLE_SCORES_NAME: process.env.TABLE_SCORES_NAME,
  TABLE_EVENTS_NAME: process.env.TABLE_EVENTS_NAME,
}

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

    // Record product's contributor registration
    const expression = [
      'set',
      '#c=if_not_exists(#c,:c),',
      '#cb=if_not_exists(#cb,:cb),',
      '#u=:u,',
      '#ub=:ub,',
      '#ro=:ro,', // NB don't need to check if exists, because order guarantee means registration event will always come first and nature of hello-retail does not have any way to change a creator or photographer, once registered
      '#sc=:sc,', // NB don't need to check if exists, because order guarantee means registration event will always come first and nature of hello-retail does not have any way to change a creator or photographer, once registered
      '#ev=:ev',
    ]
    const attNames = {
      '#c': 'created',
      '#cb': 'createdBy',
      '#u': 'updated',
      '#ub': 'updatedBy',
      '#ro': role,
      '#sc': `${role}Score`, // These scores may be different for the two roles because some purchases may happen between the time that the creator and photographer registered
      '#ev': 'lastEventId',
    }
    const attValues = {
      ':c': updated,
      ':cb': event.origin,
      ':u': updated,
      ':ub': event.origin,
      ':ro': event.origin,
      ':sc': 0,
      ':ev': event.eventId,
    }

    if (role === 'creator') {
      expression.push(', #ap=:ap')
      attNames['#ap'] = 'awaitPhotographer'
      attValues[':ap'] = true
    } else if (role === 'photographer') {
      expression.push('remove #ap=:ap')
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

    // Update product scores for the purchase event.  NB We know at least one contributor exists, because order guarantee says that the creation event had to have happened already.
    const expression = [
      'set',
      '#c=if_not_exists(#c,:c),',
      '#cb=if_not_exists(#cb,:cb),',
      '#u=:u,',
      '#ub=:ub,',
      '#sc=#sc + :inc,', // Don't need to check if this exist because order guarantee says this already will be there
      '#sp=if_not_exists(#ap,:#sp + :inc),', // Only increment this if photographer has registered, which removes the awaitPhotographer attribute TODO check if this really works when the path is different from the attribute
      '#ev=:ev',
    ]
    const attNames = {
      '#c': 'created',
      '#cb': 'createdBy',
      '#u': 'updated',
      '#ub': 'updatedBy',
      '#sc': 'creatorScore', // These may be different for the two roles because some purchases may happen between the time that the creator and photographer registered
      '#sp': 'photographerScore',
      '#ap': 'awaitPhotographer', // For the conditional on whether photographer exists yet
      '#ev': 'lastEventId',
    }
    const attValues = {
      ':c': updated,
      ':cb': origin,
      ':u': updated,
      ':ub': origin,
      ':inc': 1,
      ':ev': eventId,
    }
    const callback = (err) => {
      if (err) {
        complete(`${constants.METHOD_UPDATE_PURCHASE_EVENT} - errors updating DynamoDb: ${err}`)
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
      ConditionExpression: '#ev < ev',
      ExpressionAttributeNames: attNames,
      ExpressionAttributeValues: attValues,
      ReturnValues: 'NONE',
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
    }
    dynamo.update(dbParamsEvents, callback)
  },
  /**
   * Update scores table on whatever contributor(s) were just affected.
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
        }

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

        // Because this method is only called through the occurrence of a purchase event and that must be subsequent to a creator registration, we definitely have a creator field
        const dbParamsCreator = {
          TableName: constants.TABLE_CONTRIBUTIONS_NAME,
          IndexName: 'ProductsByCreator',
          ProjectionExpression: '#i #s', // TODO remove id after removing console.log, only need the score really
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

            const foundScores = response.Items.map(item => item.creatorScore)
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

        if (data.photographer) {
          const dbParamsPhotographer = {
            TableName: constants.TABLE_CONTRIBUTIONS_NAME,
            IndexName: 'ProductsByPhotographer',
            ProjectionExpression: '#i #s', // TODO remove id after removing console.log, only need the score really
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

              const foundScores = response.Items.map(item => item.photographerScore)
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
        } else { // free pass
          updateCallback()
        }
      }
    })
  },
  /**
   * Process the given event, reporting failure or success to the given callback
   * @param event The event to validate and process with the appropriate logic
   * @param complete The callback with which to report any errors
   */
  processEvent: (event, complete) => {
    if (!event || !event.schema) {
      complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} event or schema was not truthy.`)
    } else if (event.schema !== eventSchemaId) {
      complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} event did not have proper schema.  observed: '${event.schema}' expected: '${eventSchemaId}'`)
    } else if (!ajv.validate(eventSchemaId, event)) {
      complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} could not validate event to '${eventSchemaId}' schema.  Errors: ${ajv.errorsText()}`)
    } else if (event.data.schema === productCreateSchemaId) {
      if (!ajv.validate(productCreateSchemaId, event.data)) {
        complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} could not validate event to '${productCreateSchemaId}' schema. Errors: ${ajv.errorsText()}`)
      } else {
        impl.registerContributor('creator', event, complete)
      }
    } else if (event.data.schema === productImageSchemaId) {
      if (!ajv.validate(productImageSchemaId, event.data)) {
        complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} could not validate event to '${productImageSchemaId}' schema. Errors: ${ajv.errorsText()}`)
      } else {
        impl.registerContributor('photographer', event, complete)
      }
    } else if (event.data.schema === productPurchaseSchemaId) {
      if (!ajv.validate(productPurchaseSchemaId, event.data)) {
        complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} could not validate event to '${productPurchaseSchemaId}' schema. Errors: ${ajv.errorsText()}`)
      } else {
        impl.updatePurchaseEvent(event, complete)
      }
    } else {
      // TODO remove console.log and pass the above message once we are only receiving subscribed events
      console.log(`${constants.MODULE} ${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} - event with unsupported schema (${event.data.schema}) observed.`)
      complete()
    }
  },
}

// TODO separate out kinesis-consuming code into a module

module.exports = {
  /**
   * Example Kinesis Event:
   * {
   *   "Records": [
   *     {
   *       "kinesis": {
   *         "kinesisSchemaVersion": "1.0",
   *         "partitionKey": "undefined",
   *         "sequenceNumber": "49568749374218235080373793662003016116473266703358230578",
   *         "data": "eyJzY2hlbWEiOiJjb20ubm9yZHN0cm9tL3JldGFpb[...]Y3NDQiLCJjYXRlZ29yeSI6IlN3ZWF0ZXJzIGZvciBNZW4ifX0=",
   *         "approximateArrivalTimestamp": 1484245766.362
   *       },
   *       "eventSource": "aws:kinesis",
   *       "eventVersion": "1.0",
   *       "eventID": "shardId-000000000003:49568749374218235080373793662003016116473266703358230578",
   *       "eventName": "aws:kinesis:record",
   *       "invokeIdentityArn": "arn:aws:iam::515126931066:role/devProductCatalogReaderWriter",
   *       "awsRegion": "us-west-2",
   *       "eventSourceARN": "arn:aws:kinesis:us-west-2:515126931066:stream/devRetailStream"
   *     },
   *     {
   *       "kinesis": {
   *         "kinesisSchemaVersion": "1.0",
   *         "partitionKey": "undefined",
   *         "sequenceNumber": "49568749374218235080373793662021150003767486140978823218",
   *         "data": "eyJzY2hlbWEiOiJjb20ubm9yZHN0cm9tL3JldGFpb[...]I3MyIsImNhdGVnb3J5IjoiU3dlYXRlcnMgZm9yIE1lbiJ9fQ==",
   *         "approximateArrivalTimestamp": 1484245766.739
   *       },
   *       "eventSource": "aws:kinesis",
   *       "eventVersion": "1.0",
   *       "eventID": "shardId-000000000003:49568749374218235080373793662021150003767486140978823218",
   *       "eventName": "aws:kinesis:record",
   *       "invokeIdentityArn": "arn:aws:iam::515126931066:role/devProductCatalogReaderWriter",
   *       "awsRegion": "us-west-2",
   *       "eventSourceARN": "arn:aws:kinesis:us-west-2:515126931066:stream/devRetailStream"
   *     }
   *   ]
   * }
   * @param kinesisEvent The Kinesis event to decode and process.
   * @param context The Lambda context object.
   * @param callback The callback with which to call with results of event processing.
   */
  processKinesisEvent: (kinesisEvent, context, callback) => {
    try {
      console.log(`${constants.MODULE} ${constants.METHOD_PROCESS_KINESIS_EVENT} - kinesis event received: ${JSON.stringify(kinesisEvent, null, 2)}`)
      if (
        kinesisEvent &&
        kinesisEvent.Records &&
        Array.isArray(kinesisEvent.Records)
      ) { // TODO convert this to handle events synchronously, if needed to preserve a sequentially-ordered batch
        let successes = 0
        const complete = (err) => {
          if (err) {
            console.log(err)
            // TODO uncomment following
            // throw new Error(`${constants.MODULE} ${err}`);
            // TODO remove rest of block to use above.
            const msg = `${constants.MODULE} ${err}`
            if (msg.indexOf(`${constants.MODULE} ${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG}`) !== -1) {
              console.log('######################################################################################')
              console.log(msg)
              console.log('######################################################################################')
              successes += 1
            } else {
              throw new Error(msg)
            }
          } else {
            successes += 1
          }
          if (successes === kinesisEvent.Records.length) {
            console.log(`${constants.MODULE} ${constants.METHOD_PROCESS_KINESIS_EVENT} - all ${kinesisEvent.Records.length} events processed successfully.`)
            callback()
          }
        }
        for (let i = 0; i < kinesisEvent.Records.length; i++) {
          const record = kinesisEvent.Records[i]
          if (
            record.kinesis &&
            record.kinesis.data
          ) {
            let parsed
            try {
              const payload = new Buffer(record.kinesis.data, 'base64').toString()
              console.log(`${constants.MODULE} ${constants.METHOD_PROCESS_KINESIS_EVENT} - payload: ${payload}`)
              parsed = JSON.parse(payload)
            } catch (ex) {
              complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} failed to decode and parse the data - "${ex.stack}".`)
            }
            if (parsed) {
              impl.processEvent(parsed, complete)
            }
          } else {
            complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} record missing kinesis data.`)
          }
        }
      } else {
        callback(`${constants.MODULE} ${constants.METHOD_PROCESS_KINESIS_EVENT} - no records received.`)
      }
    } catch (ex) {
      console.log(`${constants.MODULE} ${constants.METHOD_PROCESS_KINESIS_EVENT} - exception: ${ex.stack}`)
      callback(ex)
    }
  },
}

console.log(`${constants.MODULE} - CONST: ${JSON.stringify(constants, null, 2)}`)
console.log(`${constants.MODULE} - ENV:   ${JSON.stringify(process.env, null, 2)}`)
