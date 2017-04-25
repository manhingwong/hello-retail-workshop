# Lesson 6: Create a DynamoDB view of the merchant's and photographer's work and sales, using the Kinesis stream an event collection, but without an explicit order guarantee on the events within it
Goal: Deploy a new lambda function that reads from the very beginning of your kinesis event stream.  This Lambda function looks for new item events, new photograph events, and sales events.
As items are created and photographed, the contributions table will be updated.  As they are sold, the scores table is updated.  This data view of the raw events will be used in Lesson 3 to expose the winners.  The design differs from that of Lesson 2 in that this does not assume the existence of an order guarantee on the stream.

### Step 1: In your cloned repo, go to the winner-view directory

### Step 2: View the serverless.yml you find there
You can see that there is a lambda function, two DynamoDB tables, and a role with a set of policies that are deployed here.  Compare this with the service in Lesson2, which had just two tables.  There are three tables here, as the Events table is needed to compensate for the Kinesis stream receiving the events without an order guarantee.  Unlike in Lesson 2, the purchase events must be kept unaggregated in the Events table.

Notice that the winner lambda has its event trigger as the stream and its starting point is the trim horizon - that means when its deployed, it will read all events from the beginning of the stream, one micro-batch at a time.  The micro-batch size is determined in the serverless.yml by batchSize - this ensures that when the stream is backed-up, each lambda will process a reasonable number of events.

### Step 3: View the lambda code (winner.js)
Here you can see that the lambda is parsing events and updating the contributions and scores DynamoDB tables as appropriate.  A lot of the code here is schema and input validation.

### Step 4: Deploy these resources, roles, and lambda function
From your winner-view directory
```sh
$ npm install
$ serverless deploy -s $STAGE
```
### Step 5: confirm that the lambda function is deployed
Look in the AWS console under Lambda - look for the winner lambda
Look in the AWS console under DynamoDB - look for contributions and scores tables

### Step 6: Confirm that the Lambda function ran and the tables populated
Check your contributions and scores Dynamo tables and look for the data to be populated there.

