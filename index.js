const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7xkdi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const tasksCollection = client.db("earnlyDb").collection("tasks");
    const usersCollection = client.db("earnlyDb").collection("users");

    // app.post('/users/:email', async (req, res) => {

    //   const { name, email, image, role }  = req.body;

    //   const initialCoins = role === 'Worker' ? 10 : 50;
    //   const user = {
    //     name,
    //     email,
    //     image,
    //     role: role || "Worker",
    //     coins: initialCoins,
    //     timestamp: new Date(),
    //   };

    //   const filter = { email };
    //   const options = { upsert: true };
    //   const updateDoc = {
    //     $setOnInsert: user,
    //   };

    //   const result = await usersCollection.updateOne(filter, updateDoc, options);
    //   res.send(result);
    // });

    app.post("/users/:email", async (req, res) => {
      const { name, email, image, role } = req.body;

      const filter = { email };
      const updateDoc = {
        $set: {
          name: name || "Anonymous",
          image: image || "",
          role: role || "Worker",
          timestamp: new Date(),
        },
        $setOnInsert: {
          coins: role === "Worker" ? 10 : 50, 
        },
      };
      const options = { upsert: true };

      const result = await usersCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    app.get("/tasks", async (req, res) => {
      const result = await tasksCollection.find().toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Earnly is running");
});

app.listen(port, () => {
  console.log(`Earnly is sitting on port ${port}`);
});
