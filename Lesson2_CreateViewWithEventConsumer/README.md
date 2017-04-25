# Lesson 2: Create a DynamoDB view of the merchant's and photographer's work and sales, using the Kinesis stream as an event log
Goal: Deploy a new lambda function that reads from the very beginning of your kinesis event stream.  This Lambda function looks for new item events, new photograph events, and sales events.
As items are created and photographed, the contributions table will be updated.  As they are sold, the scores table is updated.

### Step 1: In your cloned repo, go to the winner-view directory

### Step 2: View the serverless.yml you find there
You can see that there is a lambda function, two DynamoDB tables, and a role with a set of policies that are deployed here.  The serverless framework uses this yaml file to generate and execute cloudformation templates.

Notice that the winner lambda has its event trigger as the stream and its starting point is the trim horizon - that means when its deployed, it will read all events from the beginning of the log, one micro-batch at a time.  The micro-batch size is determined in the serverless.yml by batchSize - this ensures that when the stream is backed-up, each lambda will process a reasonable number of events.

### Step 3: View the lambda code (winner.js)
Here you can see that the lambda is parsing events and updating the contributions and scores DynamoDB tables as appropriate.

The code tracks the eventId of only the last processed purchase, a benefit of the order guarantee.  It tracks this so that re-tries do not get re-processed.

The Contributions table is updated with not only the eventId of the last purchase, but also the total quantity of that product purchased, which is an aggregation of purchase events.
It is important to note that the aggregation can only be at the product level, within the Contributions table.  We cannot, without arduous coding, maintain an aggregation at the level of the Scores table, even though that is the information we ultimately want.

This is because the scores accumulate over all products.  Product events will be placed into different shards, because the partition key is based on product ID.  *The order guarantee applies only within a shard.*  Across shards, we cannot establish order without explicit work, some resolution strategy, and a need for additional variables to be tracked.  Therefore, simply maintaining the identity of the last processed purchase event within the Scores table will not guarantee a correct aggregation directly on the scores.  This simplification works only in the Contributions table, aggregating at the product level, since we know all events relevant to that product will be hashed into the same shard, where there *is* an order guarantee.

### Step 4: Deploy these resources, roles, and lambda function
From your winner-view directory
```sh
$ npm install
$ serverless deploy -s <your stage name>
```
### Step 5: confirm that the lambda function is deployed
Look in the AWS console under Lambda - look for the winner lambda
Look in the AWS console under DynamoDB - look for contributions and scores tables

### Step 6: Confirm that the Lambda function ran and the tables populated
Check your contributions and scores Dynamo tables and look for the data to be populated there.

