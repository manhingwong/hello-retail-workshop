# Lesson 12: Create a DynamoDB view of the merchant's and photographer's work and sales, exploiting an order guarantee that makes the Kinesis stream an event log
Goal: Deploy a new lambda function that reads from the very beginning of your kinesis event stream.  This Lambda function looks for new item events, new photograph events, and sales events.
As items are created and photographed, the contributions table will be updated.  As they are sold, the scores table is updated.  The design differs from that of Lesson2 in that this assumes the existence of an order guarantee.

// TODO define order guarantee and define event log and how a Kinesis stream can be such a thing (provided it receives the events as they occur).  Then explain how we shall guarantee order in the hello-retail-workshop system, i.e.,
// 1) Ensure the fanout not forward events in parallel by setting the --parallel false flag.  Without this flag in-shard ordering is not guaranteed on forwarding
// 2) When receiving a batch of events from Kinesis, ensure the winner.js code not process them in parallel by setting the flag for synchronous processing (TODO modularize the Kinesis processing code and add this synchronous feature and flag)

### Step 0: In the fanout, update the registered stream with --parallel false
// TODO provide command and move this bit to the Teacher's Guide

### Step 1: In your cloned repo, go to the winner-view directory

### Step 2: View the serverless.yml you find there
You can see that there is a lambda function, two DynamoDB tables, and a role with a set of policies that are deployed here.  Compare this with the service in Lesson2, which had three tables.  There are only two tables here, as the Events table will no longer be needed, thanks to using the Kinesis stream as an event log.

Notice that the winner lambda has its event trigger as the stream and its starting point is the trim horizon - that means when its deployed, it will read all events from the beginning of the log, one micro-batch at a time.  The micro-batch size is determined in the serverless.yml by batchSize - this ensures that when the stream is backed-up, each lambda will process a reasonable number of events.

### Step 3: View the lambda code (winner.js)
Here you can see that the lambda is parsing events and updating the contributions and scores DynamoDB tables as
appropriate.  One difference with Lesson2 is that the Kinesis processing code is set to process batches synchronously.
Another is that, in lieu of maintaining an Events table, the code now need only track the eventId of the last processed purchase, a benefit of the order guarantee.  It also no longer need track when a contributor registered, as the order guarantee ensures that these events are delivered before the purchase (that being the true order of the events that occurred).
The Contributions table is now being updated with not only the eventId of the last purchase, but also with the number of that product purchased, an aggregation of the information previously kept unaggregated in the Events table.
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

