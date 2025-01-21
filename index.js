const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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

    const usersCollection = client.db("earnlyDb").collection("users");
    const tasksCollection = client.db("earnlyDb").collection("tasks");
    const submissionsCollection = client
      .db("earnlyDb")
      .collection("submissions");


      app.get('/users',  async (req, res) => {
        const result = await usersCollection.find().toArray();
        res.send(result);
      });
    app.get("/users/:email", async (req, res) => {
      const { email } = req.params;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const { name, email, image, role, coins } = req.body;

      const filter = { email };
      const updateDoc = {
        $set: {
          name: name || "Anonymous",

          image: image || "",
          role: role || "",
          coins: coins || 0,
          timestamp: new Date().toISOString().split("T")[0],
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

    app.delete('/users/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    })

    app.get("/tasks", async (req, res) => {
      const email = req.query.email; // Optional query parameter to filter by user's email

      const matchStage = email ? { userEmail: email } : {};

      const result = await tasksCollection
        .aggregate([
          { $match: matchStage },
          {
            $lookup: {
              from: "users",
              localField: "userEmail",
              foreignField: "email",
              as: "userDetails",
            },
          },
          {
            $addFields: {
              Buyer_name: { $arrayElemAt: ["$userDetails.name", 0] },
            },
          },
          { $project: { userDetails: 0 } },
        ])
        .toArray();

      res.send(result);
    });

    app.get("/tasks/:id", async (req, res) => {
      const id = req.params.id;
    
      try {
        const result = await tasksCollection
          .aggregate([
            { $match: { _id: new ObjectId(id) } },
            {
              $lookup: {
                from: "users",
                localField: "userEmail",
                foreignField: "email",
                as: "userDetails",
              },
            },
            {
              $addFields: {
                Buyer_name: { $arrayElemAt: ["$userDetails.name", 0] },
              },
            },
            { $project: { userDetails: 0 } }, 
          ])
          .toArray();
    
        if (result.length === 0) {
          return res.status(404).send({ message: "Task not found." });
        }
    
        res.send(result[0]);
      } catch (error) {
        res.status(500).send({ message: "Error fetching task details.", error });
      }
    });

    app.get("/submissions", async (req, res) => {
      const worker_email = req.query.worker_email;
      const query = {worker_email}
      
      const result = await submissionsCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/submissions", async (req, res) => {
      const { _id, ...submission } = req.body;
      const result = await submissionsCollection.insertOne(submission);
      res.send(result);
    });
    app.delete('/submissions/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await submissionsCollection.deleteOne(query);
      res.send(result);
    });

    

    app.post("/tasks", async (req, res) => {
      const newTask = req.body;
      const { userEmail, totalPayableAmount } = newTask;
      const user = await usersCollection.findOne({ email: userEmail });

      if (!user || user.coins < totalPayableAmount) {
        return res.status(400).send({ message: "Insufficient coins" });
      }

      // const updatedCoins = user.coins - totalPayableAmount;
      await usersCollection.updateOne(
        { email: userEmail },
        { $inc: { coins: -totalPayableAmount } }
      );

      const result = await tasksCollection.insertOne(newTask);
      res.send(result);
    });

    app.put("/tasks/:id", async (req, res) => {
      const { id } = req.params;
      const updatedTask = req.body;

      const existingTask = await tasksCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!existingTask) {
        return res
          .status(404)
          .send({ success: false, message: "Task not found." });
      }

      const oldTotalPayable =
        existingTask.requiredWorkers * existingTask.payableAmount;
      const newTotalPayable =
        updatedTask.requiredWorkers * updatedTask.payableAmount;

      const coinDifference = oldTotalPayable - newTotalPayable;

      // Update user's coin balance
      const userUpdateResult = await usersCollection.updateOne(
        { email: existingTask.userEmail },
        { $inc: { coins: coinDifference } }
      );

      if (userUpdateResult.modifiedCount === 0) {
        return res
          .status(400)
          .send({ success: false, message: "Failed to update user coins." });
      }

      const result = await tasksCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedTask }
      );

      if (result.modifiedCount === 0) {
        return res.status(404).send({
          success: false,
          message: "Task not found or no changes made.",
        });
      }
      res.send({ success: true, message: "Task updated successfully." });
    });

    app.delete("/tasks/:id", async (req, res) => {
      const { id } = req.params;
      const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
      if (!task) {
        return res
          .status(404)
          .send({ success: false, message: "Task not found." });
      }
      // Delete the task
      const deleteResult = await tasksCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (deleteResult.deletedCount === 0) {
        return res
          .status(400)
          .send({ success: false, message: "Failed to delete the task." });
      }

      // If the task is not completed, calculate the refill amount
      if (!task.isCompleted) {
        const refillAmount = task.requiredWorkers * task.payableAmount;
        await usersCollection.updateOne(
          { email: task.userEmail },
          { $inc: { coins: refillAmount } }
        );
      }
      res.send({ success: true, message: "Task deleted successfully." });
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
