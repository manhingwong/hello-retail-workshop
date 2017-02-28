#Lesson 4: Extra credit!  Create your own hot products, trending products, and/or recommendations system.

Now that you know how to create an event consumer and populate a DynamoDB table, there are all kinds of interesting features you can build.

####Interesting events on the stream
* Product detail page views
* Category page views
* Purchase events
* ***add specifics here

####Hot products
We know that customers that view the same item multiple times are interested in the product.  Create a table and web service that shows the top products that have been frequently viewed (three or more times) by the most unique users.

####Trending (time weighted) products
How would you include time-weighting to your hot products service to ensure that the hot products don't get stale?

####Collaborative filtering tables
Can you create a view that maintains a sorted count of "people who viewed this product also viewed"?  How about bought/bought? viewed/bought? frequently viewed/frequently viewed?  How would you expose this as a recommendation service that could be used from the product detail page?

####Cost and latency improvements
If you had 100,000,000 page views a day, how much would your service cost?  How could you make it more efficient?  How can you trade off pre-computing results into a table vs computing the results on demand from a raw activity table?  What are the performance implications?




