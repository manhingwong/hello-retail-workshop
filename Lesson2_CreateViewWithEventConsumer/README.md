#Lesson 2: Create an event consumer that generates a dynamoDB view of the merchants and photographer's work and sales
Goal: Deploy a new lambda function that will read from the very beginning of the kinesis event stream.  This Lambda function will look for new item events, new photograph events, and sales events.
As items as created and photographed, the makers table will be updated.  As they are sold, the winners table is updated.  This data view of the raw events will be used in the next lesson to expose the winners.

###Step 1: In your cloned repo, go to the maker-view directory

###Step 2: View the serverless.yml you find there
This yml file is used by the serverless.com deployment framework to deploy resources, services, and code to AWS.  You can see that there is a lambda function and a dynamodb table ***two? that are deployed here.

###Step 3: View the lambda code
Here you can see that the lambda is retrieving a set of events and updating the dynamoDB tables as appropriate.

###Step 4: Deploy these componenets
From the maker-view directory
```sh
$ serverless deploy serverless.yml
```
###Step 5: confirm that the lambda function deployed
Look in the AWS console under Lambda
Look in the AWS console under DynaoDB

###Step 6: Confirm that the Lambda function ran and the tables popuated
Check the dynamo table and look for makers and winners
