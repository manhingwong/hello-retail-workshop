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
  METHOD_RECORD_CONTRIBUTION: 'recordContribution',
  METHOD_UPDATE_SCORES_TABLES: 'updateScoresTable',
  METHOD_VERIFY_NEW_PURCHASE: 'verifyNewPurchase',
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
   * @param event Either a product/create or a product/image event.
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  recordContribution: (role, event, complete) => {
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
        complete(`${constants.METHOD_RECORD_CONTRIBUTION} - errors updating DynamoDb: ${[priorErr, err]}`)
      } else if (priorErr || err) {
        complete(`${constants.METHOD_RECORD_CONTRIBUTION} - error updating DynamoDb: ${priorErr || err}`)
      } else { // second update result if error was not previously seen
        complete()
      }
    }

    // Initialize row in Scores table for this contributor
    const dbParamsScores = {
      TableName: constants.TABLE_SCORES_NAME,
      Key: {
        userId: event.origin,
        role,
      },
      UpdateExpression: [
        'set',
        '#c=if_not_exists(#c,:c),',
        '#cb=if_not_exists(#cb,:cb),',
        '#sc=if_not_exists(#sc, :num)',
      ].join(' '),
      ExpressionAttributeNames: {
        '#c': 'created',
        '#cb': 'createdBy',
        '#sc': 'score',
      },
      ExpressionAttributeValues: {
        ':c': updated,
        ':cb': event.origin,
        ':num': 0,
      },
      ReturnValues: 'NONE',
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
    }
    dynamo.update(dbParamsScores, updateCallback)

    // Record product's contributor
    const expression = [
      'set',
      '#c=if_not_exists(#c,:c),',
      '#cb=if_not_exists(#cb,:cb),',
      '#u=:u,',
      '#ub=:ub,',
    ]
    if (role === 'creator') {
      expression.push('#ag=if_not_exists(#ag,:ag)')
    } else if (role === 'photographer') {
      expression.push('#ag=:ag')
    }
    const attNames = {
      '#c': 'created',
      '#cb': 'createdBy',
      '#u': 'updated',
      '#ub': 'updatedBy',
      '#ag': role,
    }
    const attValues = {
      ':c': updated,
      ':cb': event.origin,
      ':u': updated,
      ':ub': event.origin,
      ':ag': event.origin,
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
   * @param data The data record retrieved from the Contributions table to know whom to credit.
   * @param event The purchase event.
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  updateScoresTable: (id, data, origin, complete) => {
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
    if (!data || (!data.creator && !data.photographer)) {
      console.log(`No contributor information for product ${id}, so no effect on scores.`)
      // TODO could log this to an UNKNOWN contributor for both
      complete()
    } else {
      const updateExp = [
        'set',
        '#u=:u,',
        '#ub=:ub,',
        '#sc=#sc + :num',
      ].join(' ')
      const attNames = {
        '#u': 'updated',
        '#ub': 'updatedBy',
        '#sc': 'score',
      }
      const attValues = {
        ':u': updated,
        ':ub': origin,
        ':num': 1,
      }
      if (data.creator) {
        const dbParamsCreator = {
          TableName: constants.TABLE_SCORES_NAME,
          Key: {
            userId: data.creator,
            role: 'creator',
          },
          UpdateExpression: updateExp,
          ExpressionAttributeNames: attNames,
          ExpressionAttributeValues: attValues,
          ReturnValues: 'NONE',
          ReturnConsumedCapacity: 'NONE',
          ReturnItemCollectionMetrics: 'NONE',
        }
        dynamo.update(dbParamsCreator, updateCallback)
      } else { // TODO could log this to an UNKNOWN contributor instead
        updateCallback()
      }
      if (data.photographer) {
        const dbParamsPhotographer = {
          TableName: constants.TABLE_SCORES_NAME,
          Key: {
            userId: data.photographer,
            role: 'photographer',
          },
          UpdateExpression: updateExp,
          ExpressionAttributeNames: attNames,
          ExpressionAttributeValues: attValues,
          ReturnValues: 'NONE',
          ReturnConsumedCapacity: 'NONE',
          ReturnItemCollectionMetrics: 'NONE',
        }
        dynamo.update(dbParamsPhotographer, updateCallback)
      } else { // TODO could log this to an UNKNOWN contributor instead
        updateCallback()
      }
    }
  },
  /**
   * Log latest purchase of a given product id to the Contributions table, creating the product record, if needed.
   * (This is in case the fanout doesn't connect till the create event has passed.)
   * @param id The product id.
   * @param eventId The event id from the event that is currently being processed.
   * @param origin The generator of the event (for logging the source of the update).
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  updateEventId: (id, eventId, origin, complete) => {
    const updated = Date.now()

    // Record latest event id
    const expression = [
      'set',
      '#c=if_not_exists(#c,:c),',
      '#cb=if_not_exists(#cb,:cb),',
      '#u=:u,',
      '#ub=:ub,',
      '#ag=:ag',
    ]
    const attNames = {
      '#c': 'created',
      '#cb': 'createdBy',
      '#u': 'updated',
      '#ub': 'updatedBy',
      '#ag': 'lastEventId',
    }
    const attValues = {
      ':c': updated,
      ':cb': origin,
      ':u': updated,
      ':ub': origin,
      ':ag': eventId,
    }

    const dbParamsContributions = {
      TableName: constants.TABLE_CONTRIBUTIONS_NAME,
      Key: {
        productId: id,
      },
      UpdateExpression: expression.join(' '),
      ExpressionAttributeNames: attNames,
      ExpressionAttributeValues: attValues,
      ReturnValues: 'NONE',
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
    }
    dynamo.update(dbParamsContributions, complete)
  },
  verifyNewPurchase: (event, complete) => {
    let priorErr
    const updateCallback = (err) => {
      if (priorErr === undefined) { // first update result
        if (err) {
          priorErr = err
        } else {
          priorErr = false
        }
      } else if (priorErr && err) { // second update result, if an error was previously received and we have a new one
        complete(`${constants.METHOD_VERIFY_NEW_PURCHASE} - errors updating DynamoDb: ${[priorErr, err]}`)
      } else if (priorErr || err) {
        complete(`${constants.METHOD_VERIFY_NEW_PURCHASE} - error updating DynamoDb: ${priorErr || err}`)
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
        'lastEventId',
      ],
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
    }
    dynamo.get(dbParamsContributions, (err, data) => {
      if (err) {
        complete(`${constants.METHOD_VERIFY_NEW_PURCHASE} - errors getting product ${event.data.id} from DynamoDb table ${constants.TABLE_CONTRIBUTIONS_NAME}: ${err}`)
      } else if (data.Item && data.Item.lastEventId && data.Item.lastEventId >= event.eventId) {
        console.log(`Event processing has already moved to ${data.Item.lastEventId} for product ${event.data.id}, so discarding.`)
        complete()
      } else { // !data.Item || !data.Item.lastEventId || is the latest, then just  and update scores table
        impl.updateScoresTable(event.data.id, data.Item, event.origin, updateCallback)
        impl.updateEventId(event.data.id, event.eventId, event.origin, updateCallback)
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
        impl.recordContribution('creator', event, complete)
      }
    } else if (event.data.schema === productImageSchemaId) {
      if (!ajv.validate(productImageSchemaId, event.data)) {
        complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} could not validate event to '${productImageSchema}' schema. Errors: ${ajv.errorsText()}`)
      } else {
        impl.recordContribution('photographer', event, complete)
      }
    } else if (event.data.schema === productPurchaseSchemaId) {
      if (!ajv.validate(productPurchaseSchemaId, event.data)) {
        complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} could not validate event to '${productPurchaseSchema}' schema. Errors: ${ajv.errorsText()}`)
      } else {
        impl.verifyNewPurchase(event, complete)
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
      ) {// TODO convert this to handle events synchronously (to utilize the sequential ordering within the batch)
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
            try {
              const payload = new Buffer(record.kinesis.data, 'base64').toString('ascii')
              console.log(`${constants.MODULE} ${constants.METHOD_PROCESS_KINESIS_EVENT} - payload: ${payload}`)
              impl.processEvent(JSON.parse(payload), complete)
            } catch (ex) {
              complete(`${constants.METHOD_PROCESS_EVENT} ${constants.BAD_MSG} failed to decode and parse the data - "${ex.stack}".`)
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
