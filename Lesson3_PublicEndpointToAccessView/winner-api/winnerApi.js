'use strict'

const AJV = require('ajv')
const aws = require('aws-sdk') // eslint-disable-line import/no-unresolved, import/no-extraneous-dependencies

// TODO Get these from a better place later
const contributionRequestSchema = require('./contributions-request-schema.json')
const contributionItemsSchema = require('./contribution-items-schema.json')
const scoresRequestSchema = require('./scores-request-schema.json')
const scoreItemsSchema = require('./score-items-schema.json')

// TODO generalize this?  it is used by but not specific to this module
const makeSchemaId = schema => `${schema.self.vendor}/${schema.self.name}/${schema.self.version}`

const contributionRequestSchemaId = makeSchemaId(contributionRequestSchema)
const contributionItemsSchemaId = makeSchemaId(contributionItemsSchema)
const scoresRequestSchemaId = makeSchemaId(scoresRequestSchema)
const scoreItemsSchemaId = makeSchemaId(scoreItemsSchema)

const ajv = new AJV()
ajv.addSchema(contributionRequestSchema, contributionRequestSchemaId)
ajv.addSchema(contributionItemsSchema, contributionItemsSchemaId)
ajv.addSchema(scoresRequestSchema, scoresRequestSchemaId)
ajv.addSchema(scoreItemsSchema, scoreItemsSchemaId)

const dynamo = new aws.DynamoDB.DocumentClient()

const constants = {
  // self
  MODULE: 'winner-api/winnerApi.js',
  // methods
  METHOD_CONTRIBUTIONS: 'contributions',
  METHOD_SCORES: 'scores',
  // resources
  TABLE_CONTRIBUTIONS_NAME: process.env.TABLE_CONTRIBUTIONS_NAME,
  TABLE_SCORES_NAME: process.env.TABLE_SCORES_NAME,
  //
  INVALID_REQUEST: 'Invalid Request',
  INTEGRATION_ERROR: 'Integration Error',
  HASHES: '##########################################################################################',
  SECURITY_RISK: '!!!SECURITY RISK!!!',
  DATA_CORRUPTION: 'DATA CORRUPTION',
}

const impl = {
  response: (statusCode, body) => ({
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*', // Required for CORS support to work
      'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
    },
    body,
  }),
  clientError: (method, schemaId, ajvErrors, event) => impl.response(
    400,
    `${method} ${constants.INVALID_REQUEST} could not validate request to '${schemaId}' schema. Errors: '${ajvErrors}' found in event: '${JSON.stringify(event)}'`,
  ),
  dynamoError: (method, err) => {
    console.log(err)
    return impl.response(500, `${method} - ${constants.INTEGRATION_ERROR}`)
  },
  securityRisk: (method, schemaId, ajvErrors, items) => {
    console.log(constants.HASHES)
    console.log(constants.SECURITY_RISK)
    console.log(`${method} ${constants.DATA_CORRUPTION} could not validate data to '${schemaId}' schema. Errors: ${ajvErrors}`)
    console.log(`${method} ${constants.DATA_CORRUPTION} bad data: ${JSON.stringify(items)}`)
    console.log(constants.HASHES)
    return impl.response(500, `${method} - ${constants.INTEGRATION_ERROR}`)
  },
  success: items => impl.response(200, JSON.stringify(items)),
  extractor: (item) => {
    const extract = impl.eventSource(item.userId)
    return {
      userId: `${extract.friendlyName} (${extract.userId})`,
      score: item.score,
    }
  },
  best: (limit, role, items) => {
    if (!items || items.length === 0) {
      return impl.success(`Not one ${role} found to have sold anything.`)
    }
    if (limit) {
      return impl.success(items.splice(0, limit).map(impl.extractor))
    } else {
      return impl.success(impl.extractor(items[0]))
    }
  },
  /**
   * Determine the source of the event from the origin, which is of format widget/role/uniqueId/friendlyName.
   * @param event The event to validate and process with the appropriate logic
   */
  eventSource: (origin) => {
    const parts = origin.split('/')
    if (parts.length > 2) {
      return {
        uniqueId: parts[2],
        friendlyName: parts.length === 3 ? parts[2] : parts[3],
      }
    } else if (parts.length === 2) {
      return {
        uniqueId: parts[1],
        friendlyName: parts[1],
      }
    } else {
      return {
        uniqueId: 'UNKNOWN',
        friendlyName: 'UNKNOWN',
      }
    }
  },
}
const api = {
  // TODO do something with this, other than getting all product ids with contributor info
  contributions: (event, context, callback) => {
    if (!ajv.validate(contributionRequestSchemaId, event)) { // bad request
      callback(null, impl.clientError(constants.METHOD_CONTRIBUTIONS, contributionRequestSchemaId, ajv.errorsText()), event)
    } else {
      const params = {
        TableName: constants.TABLE_CONTRIBUTIONS_NAME,
        AttributesToGet: ['productId'],
      }
      dynamo.scan(params, (err, data) => {
        if (err) { // error from dynamo
          callback(null, impl.dynamoError(constants.METHOD_CONTRIBUTIONS, err))
        } else if (!ajv.validate(contributionItemsSchemaId, data.Items)) { // bad data in dynamo
          callback(null, impl.securityRisk(constants.METHOD_CONTRIBUTIONS, contributionItemsSchemaId, ajv.errorsText()), data.Items) // careful if the data is sensitive
        } else { // valid
          callback(null, impl.success(data.Items))
        }
      })
    }
  },
  scores: (event, context, callback) => {
    if (!ajv.validate(scoresRequestSchemaId, event)) { // bad request
      callback(null, impl.clientError(constants.METHOD_SCORES, scoresRequestSchemaId, ajv.errorsText()), event)
    } else {
      const params = {
        TableName: constants.TABLE_SCORES_NAME,
        IndexName: 'ScoresByRole',
        ProjectionExpression: '#i, #s',
        KeyConditionExpression: '#r = :r',
        ExpressionAttributeNames: {
          '#i': 'userId',
          '#r': 'role',
          '#s': 'score',
        },
        ExpressionAttributeValues: {
          ':r': event.queryStringParameters.role,
        },
        ScanIndexForward: false,
      }
      dynamo.query(params, (err, data) => {
        if (err) { // error from dynamo
          callback(null, impl.dynamoError(constants.METHOD_SCORES, err))
        } else if (!ajv.validate(scoreItemsSchemaId, data.Items)) { // bad data in dynamo
          callback(null, impl.securityRisk(constants.METHOD_SCORES, scoreItemsSchemaId, ajv.errorsText()), data.Items) // careful if the data is sensitive
        } else { // valid
          callback(null, impl.best(event.queryStringParameters.limit, event.queryStringParameters.role, data.Items))
        }
      })
    }
  },
}

module.exports = {
  contributions: api.contributions,
  scores: api.scores,
}
