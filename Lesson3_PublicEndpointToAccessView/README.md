#Lesson 3: Display Stats
Goal: cd to winner-api, npm install, and deploy serverless.yml to create an endpoint to display your results

This project defines the winners API.

## API

The API is a RESTful API offered via ApiGateway.  There are two resources upon which a GET can be performed:
```
/scores?role=<creator|photographer>&limit=2
```
The limit query parameter is optional.  The default is one result when limit is not passed.

```
/contributions
```
The contributions request returns the product ids that have contributions.
