'use strict'

const AJV = require('ajv')
const aws = require('aws-sdk') // eslint-disable-line import/no-unresolved, import/no-extraneous-dependencies

// TODO Get these from a better place later
const eventSchema = require('./retail-stream-schema-ingress.json')
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
  METHOD_UPDATE_CONTRIBUTIONS_TABLES: 'updateContributionsTable',
  METHOD_UPDATE_SCORES_TABLES: 'updateScoresTable',
  METHOD_PROCESS_EVENT: 'processEvent',
  METHOD_PROCESS_KINESIS_EVENT: 'processKinesisEvent',
  // errors
  BAD_MSG: 'bad msg:',
  // resources
  TABLE_CONTRIBUTIONS_NAME: process.env.TABLE_CONTRIBUTIONS_NAME,
  TABLE_SCORES_NAME: process.env.TABLE_SCORES_NAME,
}

const impl = {
  /**
   * Update contributions tables.  Example event:
   * {
   *   "schema": "com.nordstrom/retail-stream-ingress/1-0-0",
   *   "origin": "hello-retail/product-producer-creator/uniqueId/friendlyName
   *   "timeOrigin": "2017-01-12T18:29:25.171Z",
   *   "data": {
   *     "schema": "com.nordstrom/product/create/1-0-0",
   *     "id": "4579874",
   *     "brand": "POLO RALPH LAUREN",
   *     "name": "Polo Ralph Lauren 3-Pack Socks",
   *     "description": "PAGE:/s/polo-ralph-lauren-3-pack-socks/4579874",
   *     "category": "Socks for Men"
   *   }
   * }
   * @param event Either a product/create or a product/image event.
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  updateContributionsTable: (role, event, complete) => {
    const updated = Date.now()

    const updateCallback = (err) => {
      if (err) {
        complete(`${constants.METHOD_UPDATE_CONTRIBUTIONS_TABLES} - errors updating DynamoDb for ${role}: ${err}`)
      } else {
        complete()
      }
    }

    const expression = [
      'set',
      '#c=if_not_exists(#c,:c),',
      '#cb=if_not_exists(#cb,:cb),',
      '#u=:u,',
      '#ub=:ub,',
    ]
    const attNames = {
      '#c': 'created',
      '#cb': 'createdBy',
      '#u': 'updated',
      '#ub': 'updatedBy',
    }
    const attValues = {
      ':c': updated,
      ':cb': event.origin,
      ':u': updated,
      ':ub': event.origin,
    }
    if (role === 'creator') {
      expression.push('#cr=if_not_exists(#cr,:cr)')
      attNames['#cr'] = 'creator'
      attValues[':cr'] = event.origin
    } else if (role === 'photographer') {
      expression.push('#ph=:ph')
      attNames['#ph'] = 'photographer'
      attValues[':ph'] = event.origin
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
   * Update scores table.  Example event:
   * {
   *   "schema": "com.nordstrom/retail-stream-ingress/1-0-0",
   *   "origin": "hello-retail/product-purchaser/uniqueId/friendlyName
   *   "timeOrigin": "2017-01-12T18:29:25.171Z",
   *   "data": {
   *     "schema": "com.nordstrom/product/purchase/1-0-0",
   *     "id": "4579874"
   *   }
   * }
   * @param event The purchase event.
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  updateScoresTable: (event, complete) => {
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
      } else { // second update result if error was not previously seen
        complete()
      }
    }

    const dbParamsContributions = {
      Key: {
        productId: event.data.id,
      },
      TableName: constants.TABLE_CONTRIBUTIONS_NAME,
      AttributesToGet: [
        'creator',
        'photographer',
      ],
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
    }
    dynamo.get(dbParamsContributions, (err, data) => {
      if (err) {
        complete(`${constants.METHOD_UPDATE_SCORES_TABLES} - errors getting product ${event.data.id} from DynamoDb table ${constants.TABLE_CONTRIBUTIONS_NAME}: ${err}`)
      } else if (!data.Item || (!data.Item.creator && !data.Item.photographer)) {
        console.log(`No contributor information for product ${event.data.id}, so no effect on scores.`)
        complete()
      } else {
        if (data.Item.creator) {
          const dbParamsCreator = {
            TableName: constants.TABLE_SCORES_NAME,
            Key: {
              userId: data.Item.creator,
              role: 'creator',
            },
            UpdateExpression: [
              'set',
              '#c=if_not_exists(#c,:c),',
              '#cb=if_not_exists(#cb,:cb),',
              '#u=:u,',
              '#ub=:ub,',
              '#sc=#sc + :num',
            ].join(' '),
            ExpressionAttributeNames: {
              '#c': 'created',
              '#cb': 'createdBy',
              '#u': 'updated',
              '#ub': 'updatedBy',
              '#sc': 'score',
            },
            ExpressionAttributeValues: {
              ':c': updated,
              ':cb': event.origin,
              ':u': updated,
              ':ub': event.origin,
              ':num': 1,
            },
            ReturnValues: 'NONE',
            ReturnConsumedCapacity: 'NONE',
            ReturnItemCollectionMetrics: 'NONE',
          }
          dynamo.update(dbParamsCreator, updateCallback)
        } else {
          updateCallback()
        }
        if (data.Item.photographer) {
          const dbParamsPhotographer = {
            TableName: constants.TABLE_SCORES_NAME,
            Key: {
              userId: data.Item.photographer,
              role: 'photographer',
            },
            UpdateExpression: [
              'set',
              '#c=if_not_exists(#c,:c),',
              '#cb=if_not_exists(#cb,:cb),',
              '#u=:u,',
              '#ub=:ub,',
              '#sc=#sc + :num',
            ].join(' '),
            ExpressionAttributeNames: {
              '#c': 'created',
              '#cb': 'createdBy',
              '#u': 'updated',
              '#ub': 'updatedBy',
              '#sc': 'score',
            },
            ExpressionAttributeValues: {
              ':c': updated,
              ':cb': event.origin,
              ':u': updated,
              ':ub': event.origin,
              ':num': 1,
            },
            ReturnValues: 'NONE',
            ReturnConsumedCapacity: 'NONE',
            ReturnItemCollectionMetrics: 'NONE',
          }
          dynamo.update(dbParamsPhotographer, updateCallback)
        } else {
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
        complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} could not validate event to '${productCreateSchema}' schema. Errors: ${ajv.errorsText()}`)
      } else {
        impl.updateContributionsTable('creator', event, complete)
      }
    } else if (event.data.schema === productImageSchemaId) {
      if (!ajv.validate(productImageSchemaId, event.data)) {
        complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} could not validate event to '${productImageSchema}' schema. Errors: ${ajv.errorsText()}`)
      } else {
        impl.updateContributionsTable('photographer', event, complete)
      }
    } else if (event.data.schema === productPurchaseSchemaId) {
      if (!ajv.validate(productPurchaseSchemaId, event.data)) {
        complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} could not validate event to '${productPurchaseSchema}' schema. Errors: ${ajv.errorsText()}`)
      } else {
        impl.updateScoresTable(event, complete)
      }
    } else {
      // TODO remove console.log and pass the above message once we are only receiving subscribed events
      console.log(`${constants.MODULE} ${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} - event with unsupported schema (${event.data.schema}) observed.`)
      complete()
    }
  },
}

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
      ) {
        let successes = 0
        const complete = (err) => {
          if (err) {
            // TODO uncomment following
            // throw new Error(`${constants.MODULE} ${err}`);
            // TODO remove rest of block to use above.
            const msg = `${constants.MODULE} ${err}`
            if (err.indexOf(`${constants.MODULE} ${constants.METHOD_PROCESS_EVENT}  ${constants.BAD_MSG}`) !== -1) {
              console.log('######################################################################################')
              console.log(msg)
              console.log('######################################################################################')
              successes += 1
            } else {
              throw new Error(msg)
            }
          } else {
            successes += 1
            if (successes === kinesisEvent.Records.length) {
              console.log(`${constants.MODULE} ${constants.METHOD_PROCESS_KINESIS_EVENT} - all ${kinesisEvent.Records.length} events processed successfully.`)
              callback(null, true)
            }
          }
        }
        for (let i = 0; i < kinesisEvent.Records.length; i++) {
          const record = kinesisEvent.Records[i]
          if (
            record.kinesis &&
            record.kinesis.data
          ) {
            const payload = new Buffer(record.kinesis.data, 'base64').toString('ascii')
            console.log(`${constants.MODULE} ${constants.METHOD_PROCESS_KINESIS_EVENT} - payload: ${payload}`)
            impl.processEvent(JSON.parse(payload), complete)
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
