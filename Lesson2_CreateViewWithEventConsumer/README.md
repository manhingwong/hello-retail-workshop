# Lesson 2: Create a dynamoDB view of the merchant and photographer's work and sales
Goal: Deploy a new lambda function that reads from the very beginning of your kinesis event stream.  This Lambda function looks for new item events, new photograph events, and sales events.
As items as created and photographed, the contributions table will be updated.  As they are sold, the scores table is updated.  This data view of the raw events will be used in the next lesson to expose the winners.

### Step 1: In your cloned repo, go to the maker-view directory

### Step 2: View the serverless.yml you find there
This yml file is used by the serverless.com deployment framework to deploy resources, services, and code to AWS.  You can see that there is a lambda function, two dynamodb tables, and a larger set of roles and policies that are deployed here.  The serverless framework uses this yaml file to generate and execute cloudformation templates.

Notice that the winner lambda has its event trigger as the stream and its starting point is the trim horizon - that means when its deployed, it will read all events from the beginning of the log, one micro-batch at a time.  The micro-batch size is determined in the serverless.yml by batchSize - this ensures that when the stream is backed-up, each lambda will process a reasonablenumber of events.

### Step 3: View the lambda code (winner.js)
Here you can see that the lambda is parsing events and updating the contributions and scores dynamoDB tables as appropriate.  The majority of the code here is schema and input validation.

### Step 4: Deploy these resources, roles, and lambda function
From your maker-view directory
```sh
$ serverless deploy serverless.yml
```
### Step 5: confirm that the lambda function deployed
Look in the AWS console under Lambda - look for the winner lambda
Look in the AWS console under DynaoDB - contributions and scores tables

### Step 6: Confirm that the Lambda function ran and the tables populated
Check your contributions and scores dynamo tables and look for the data to be populated there.

