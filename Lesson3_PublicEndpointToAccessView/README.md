# Lesson 3: Display highest selling photographers and merchants
Goal: Create a publicly accessible, unauthenticated RESTful API to query for the winners.

### Step 1: In your cloned repo, go to the public-endpoint directory

### Step 2: View the serverless.yml you find there
This yml file is used by the serverless.com deployment framework to deploy resources, services, and code to AWS.  You can see that there is an API Gateway, a winnerAPI function, and a few roles that are deployed here.

This yaml deploys the public RESTful endpoint that allows you to GET the winners from the web service.  If desired, you could require authentication in a variety of different ways.  For this workshop we'll be using an unauthenticated endpoint here.  Also if desired, an auto-generated SDK can be created for this endpoint in a variety of different languages and swagger can be auto-generated.  Caching can be enabled, as well as thresholds and a variety of other features.

More details can be found here: https://serverless.com/framework/docs/providers/aws/events/apigateway/

### Step 3: Deploy these components
From the public-endpoint directory
```sh
$ serverless deploy serverless.yml
```

### Step 4: confirm that the AWS API Gateway deployed
* Look in the AWS console under AWS API Gateway
* Copy the URL you find there.
* Go to that URL in your browser.
* ***add more specifics here

Note that this gateway can scale massively.  To handle a lot more traffic (thousands of TPS) you'd want to ensure that your available AWS account limits could handle the traffic and increase the read IOPs on the dynamoDB table.

You should expect about a 50ms P50 and 130ms P99 from this endpoint under any scale.  The results here will be accurate within about a second of the purchase activity from a customer on the core stream.

