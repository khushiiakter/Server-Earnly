const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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
    // await client.connect();

    const usersCollection = client.db("earnlyDb").collection("users");
    const tasksCollection = client.db("earnlyDb").collection("tasks");
    const submissionsCollection = client
      .db("earnlyDb")
      .collection("submissions");
    const paymentCollection = client.db("earnlyDb").collection("payments");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      // console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "Admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyBuyer = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isBuyer = user?.role === "Buyer";
      if (!isBuyer) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "Admin";
      }
      res.send({ admin });
    });

    app.get("/users/buyer/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let buyer = false;
      if (user) {
        buyer = user?.role === "Buyer";
      }
      res.send({ buyer });
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
    app.put("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = { $set: { role } };

      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    // Update user coins
    app.patch("/users/:email", async (req, res) => {
      const { email } = req.params;
      const { coins } = req.body;

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { coins } } // Update the user's coins
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ message: "User coins updated successfully" });
      } catch (error) {
        res.status(500).send({ message: "Error updating user coins", error });
      }
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/tasks", async (req, res) => {
      const email = req.query.email;

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
        res
          .status(500)
          .send({ message: "Error fetching task details.", error });
      }
    });

    app.get("/submissions", async (req, res) => {
      const worker_email = req.query.worker_email;
      
      
      const query = { worker_email };
  
      try {
          const result = await submissionsCollection.find(query).toArray();
          console.log("Submissions fetched from database:", result); 
          res.send(result);
      } catch (error) {
          console.error("Error fetching submissions:", error); 
          res.status(500).send({ message: "Failed to fetch submissions", error });
      }
  });
  app.get("/buyer/statistics", verifyToken, async (req, res) => {
    const buyerEmail = req.decoded.email;
  
    try {
      const tasks = await tasksCollection.find({ userEmail: buyerEmail }).toArray();
      const totalTasks = tasks.length;
      const pendingWorkers = tasks.reduce((sum, task) => sum + task.requiredWorkers, 0);
      const totalPayment = tasks.reduce((sum, task) => sum + task.requiredWorkers * task.payableAmount, 0);
  
      res.send({ totalTasks, pendingWorkers, totalPayment });
    } catch (error) {
      console.error("Error fetching buyer statistics:", error);
      res.status(500).send({ message: "Failed to fetch statistics", error });
    }
  });
  
  // Get Submissions for Buyer Tasks
  app.get("/buyer/submissions", verifyToken, async (req, res) => {
    const email = req.decoded.email; // Ensure this is the logged-in buyer's email
  
    try {
      const submissions = await submissionsCollection
        .find({ buyer_email: email, status: "pending" })
        .toArray();
      res.send(submissions);
    } catch (error) {
      res.status(500).send({ message: "Failed to fetch submissions", error });
    }
  });
  
  // Approve Submission
  app.post("/submissions/approve", verifyToken, async (req, res) => {
    const { submissionId, worker_email, payable_amount } = req.body;
  
    try {
      await submissionsCollection.updateOne(
        { _id:  ObjectId(submissionId) },
        { $set: { status: "approved" } }
      );
  
      await usersCollection.updateOne(
        { email: worker_email },
        { $inc: { coins: payable_amount } }
      );
  
      res.send({ message: "Submission approved successfully." });
    } catch (error) {
      console.error("Error approving submission:", error);
      res.status(500).send({ message: "Failed to approve submission", error });
    }
  });
  
  // Reject Submission
  app.post("/submissions/reject", verifyToken, async (req, res) => {
    const { submissionId, task_id } = req.body;
  
    try {
      await submissionsCollection.updateOne(
        { _id:ObjectId(submissionId) },
        { $set: { status: "rejected" } }
      );
  
      await tasksCollection.updateOne(
        { _id:  ObjectId(task_id) },
        { $inc: { requiredWorkers: 1 } }
      );
  
      res.send({ message: "Submission rejected successfully." });
    } catch (error) {
      console.error("Error rejecting submission:", error);
      res.status(500).send({ message: "Failed to reject submission", error });
    }
  });
  

  app.post("/submissions", async (req, res) => {
    const { _id, ...submission } = req.body;
  
    // Validate input
    if (!submission.worker_email || !submission.task_id || !submission.status) {
      return res.status(400).send({ message: "Invalid submission data" });
    }
  
    try {
      // Ensure task_id is in ObjectId format
      submission.task_id = new ObjectId (submission.task_id);
  
      const result = await submissionsCollection.insertOne(submission);
      res.send(result);
    } catch (error) {
      res.status(500).send({ message: "Failed to insert submission", error });
    }
  });
  
    app.delete("/submissions/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await submissionsCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/worker/statistics", verifyToken, async (req, res) => {
      const { worker_email } = req.query;
    
      try {
        const totalSubmissions = await submissionsCollection.countDocuments({
          worker_email,
        });
    
        const pendingSubmissions = await submissionsCollection.countDocuments({
          worker_email,
          status: "pending",
        });
    
        const totalEarnings = await submissionsCollection.aggregate([
          { $match: { worker_email, status: "approved" } },
          { $group: { _id: null, total: { $sum: "$payable_amount" } } },
        ]).toArray();
    
        res.send({
          totalSubmissions,
          pendingSubmissions,
          totalEarnings: totalEarnings[0]?.total || 0,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch worker statistics", error });
      }
    });

    app.get("/worker/approved-submissions", verifyToken, async (req, res) => {
      const { worker_email } = req.query;
    
      try {
        const approvedSubmissions = await submissionsCollection
          .find({ worker_email, status: "approved" })
          .toArray();
        res.send(approvedSubmissions);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch approved submissions", error });
      }
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

    app.put("/tasks/:id", verifyToken, verifyBuyer, async (req, res) => {
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

    app.delete("/tasks/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
      if (!task) {
        return res
          .status(404)
          .send({ success: false, message: "Task not found." });
      }

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

    

    app.post("/api/create-payment-intent", async (req, res) => {
      const { amount } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount, // Amount in cents
          currency: "usd",
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      try {
        const result = await paymentCollection.insertOne(payment);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/payments/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const payments = await paymentCollection.find({ email }).toArray();
        res.send(payments);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
