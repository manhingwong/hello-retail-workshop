#Lesson 3: Display highest selling photographers and merchants
Goal: cd to public-endpoint create an endpoint to display your results

###Step 1: In your cloned repo, go to the public-endpoint directory

###Step 2: View the serverless.yml you find there
This yml file is used by the serverless.com deployment framework to deploy resources, services, and code to AWS.  You can see that there is an API Gateway, a Kinesis stream, and a few roles that are deployed here.

###Step 3: Deploy these componenets
From the public-endpoint directory
```sh
$ serverless deploy serverless.yml
```

###Step 4: confirm that the AWS API Gateway deployed
Look in the AWS console under AWS API Gateway
Copy the URL
Go to that URL in your browser.

