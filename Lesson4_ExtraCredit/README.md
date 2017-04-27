# Lesson 4: Extra credit!  Create your own hot products, trending products, and/or recommendations system.

Now that you know how to create an event consumer and populate a DynamoDB table, there are all kinds of interesting features you can build.

#### Interesting events on the stream
* Product detail page views
* Category page views
* Purchase events
* ***add specifics here

#### Hot products
We know that customers that view the same item multiple times are interested in the product.  Create a table and web service that shows the top products that have been frequently viewed (three or more times) by the most unique users.

#### Trending (time weighted) products
How would you include time-weighting to your hot products service to ensure that the hot products don't get stale?

#### Collaborative filtering tables
Can you create a view that maintains a sorted count of "people who viewed this product also viewed"?  How about bought/bought? viewed/bought? frequently viewed/frequently viewed?  How would you expose this as a recommendation service that could be used from the product detail page?

#### Cost and latency improvements
If you had 100,000,000 page views a day, how much would your service cost?  How could you make it more efficient?  How can you trade off pre-computing results into a table vs computing the results on demand from a raw activity table?  What are the performance implications?

#### Cheat detector!
Did anyone enter more than 3 products as merchant?  Did anyone buy lots of their own product?

#### Using the AWS CLI to show Role and Stream ARNs

Using the [AWS CLI](../Lesson0_BeforeWorkshop/SETUP-AWS-CLI.md), you can execute this script to show the ARNs needed:

```sh
./show-stream-and-role-arns.sh
```

It contains the following two commands:

```sh
aws iam list-roles | grep Arn | grep $STAGE | sed -n "s/^.*\(arn\:aws\:iam\:\:[0-9]*\:role\/.*StreamWriter\).*/\1/p"
aws kinesis describe-stream --stream-name `aws kinesis list-streams | grep $STAGE | sed -n "s/^.*\"\(.*\)\".*/\1/p"` | grep StreamARN | sed -n "s/^.*\(arn\:aws\:kinesis\:.*Stream\).*/\1/p"
```

1. Here we invoke AWS CLI to list all of the roles in the account, using `aws iam list-roles`. We then use `grep` and `sed` to filter and shape the output until only the ARN for the StreamWriter role is left.
2. This two-step command starts by using the AWS command `aws kinesis list-streams` to output the names of all the Kinesis streams in the account, then we `grep` and get our stream name, which we pass to the `aws kinesis describe-stream` as the `stream-name` parameter. From all of the many properties provided for our stream, we `grep` and `sed` to just get the ARN value.

You can run the commands above removing the `grep` and `sed` portions to explore the output in its raw form and you might notice that the output is in JSON, if you have the AWS CLI configured for that.

Ultimately, `grep` and `sed` are not very maintainable as a solution and don't take advantage of the structure provided by the output.
It's recommended that you stream the output of these commands to other tools, e.g. JQ.