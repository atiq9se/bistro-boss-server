require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json())


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3kenlvg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection

    const menuCollection = client.db("bistroDb").collection("menu")
    const usersCollection = client.db("bistroDb").collection("users")
    const reviewsCollection = client.db("bistroDb").collection("reviews")
    const cartsCollection = client.db("bistroDb").collection("carts")
    const paymentsCollection = client.db("bistroDb").collection("payments")

    // jwt related api
    app.post('/jwt', async(req, res)=>{
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '1h'});
      res.send({ token })
    })

    //middlewares
    const verifyToken = (req, res, next)=>{
      //console.log(req.headers);
      //console.log('inside verify token', req.headers.authorization);
      if(!req.headers.authorization){
        return res.status(401).send({message: 'unauthorize access'})
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded)=>{
          if(err){
            return res.status(401).send({message: 'unauthorize access'})
          }
          req.decoded = decoded;
          next();
      })
    }

    //use verify admin after verifyToken
    const verifyAdmin = async( req, res, next )=>{
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if(!isAdmin){
        return res.status(403).send({message: 'forbidden access'});
      }
      next();
    }
    
    app.post('/users', async(req, res)=>{
      const user = req.body;
      //insert email if user doesnt exists
      //you can do this many ways (1.email unique, 2. upsert 3. simple checking)
      const query = {email:user.email}
      const existingUser = await usersCollection.findOne(query)
      if(existingUser){
        return res.send({message: 'user already exists', insertedId: null})
      }
      const result = await usersCollection.insertOne(user);
      res.send(result)
    })

    app.get('/users', verifyToken, verifyAdmin, async(req, res)=>{
      const result = await usersCollection.find().toArray();
      res.send(result);
    })

    app.get('/users/admin/:email', verifyToken, async(req, res)=>{
        const email = req.params.email;
        if(email !== req.decoded.email){
          return res.status(403).send({message: 'unauthoried access'})
        }
        const query = {email: email};
        const user = await usersCollection.findOne(query);
        let admin = false;
        if(user){
          admin = user?.role ==="admin";
        }
        res.send({admin});
    })

    app.patch('/users/admin/:id', async(req, res)=>{
      const id = req.params.id;
      const filter = {_id:new ObjectId(id)}
      const updateDoc = {
        $set:{
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result)
    })

    app.delete('/users/:id', async(req, res)=>{
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const result = await usersCollection.deleteOne(query)
      res.send(result)
    })

    app.get('/menu', async(req, res)=>{
        const result = await menuCollection.find().toArray();
        res.send(result)
    })

    app.post('/menu', async(req, res)=>{
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    })

    app.get('/menu/:id', async(req, res)=>{
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const result = await menuCollection.findOne(query);
      res.send(result);
    })

    app.patch('/menu/:id', async(req, res)=>{
        const item = req.body;
        const id = req.params.id;
        const filter = {_id: new ObjectId(id)}
        const updatedDoc = {
          $set:{
            name: item.name,
            category:item.category,
            recipe: item.recipe,
            price: item.price,
            image: item.image
          }
        }
        const result = await menuCollection.updateOne(filter, updatedDoc)
        res.send(result)
    })

    app.delete('/menu/:id', verifyToken, verifyAdmin, async(req, res)=>{
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const result = await menuCollection.deleteOne(query);
      res.send(result);

    })

    app.get('/reviews', async(req, res)=>{
        const result = await reviewsCollection.find().toArray();
        res.send(result)
    })

    app.post('/carts', async(req, res)=>{
      const cartItem = req.body;
      const result = await cartsCollection.insertOne(cartItem);
      res.send(result)
    })

    app.get('/carts', async(req, res)=>{
      const email = req.query.email;
      const query = {email:email}
      const result = await cartsCollection.find(query).toArray();
      res.send(result);
    })
    app.delete('/carts/:id', async(req, res)=>{
      const id = req.params.id;
      const query = {_id:new ObjectId(id)}
      const result = await cartsCollection.deleteOne(query);
      res.send(result)
    })

    //Payment intent
    app.post('/create-payment-intent', async (req, res)=>{
      const {price} = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, 'amount inside the intent')

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd', 
        payment_method_types:['card']
      })
      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    app.post('/payments', async (req, res)=>{
      const payment = req.body;
      const paymentResult = await paymentsCollection.insertOne(payment);
      
      //carefully delete each item from the database
      console.log('payment info', payment)
      const query = {_id:{
        $in: payment.cartIds.map(id=> new ObjectId(id))
      }}
      const deleteResult = await cartsCollection.deleteMany(query);
      res.send({paymentResult, deleteResult})

    })
    
    app.get('/payments/:email', async(req, res)=>{
      const query = {email: req.params.email}
      // if(req.params.email !== req.decoded.email){
      //    return res.status(303).send({message: 'unauthorized forbidden'})
      // }
      const result = await paymentsCollection.find(query).toArray();
      res.send(result)
    })

    app.get('/admin-stars', async(req, res)=>{
      const users = await usersCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentsCollection.estimatedDocumentCount();
      const payments = await paymentsCollection.find().toArray();
      const revenue = payments.reduce((total, payment)=>total+payment.price, 0)

      res.send({
        users, menuItems, orders, revenue
      })
    })

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res)=>{
    res.send('boss is sitting')
})

app.listen(port, ()=>{
    console.log(`Bistro boss in sitting on port ${port}`);
} )