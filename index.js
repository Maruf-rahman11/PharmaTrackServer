const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const dotenv = require("dotenv");
const admin = require("firebase-admin");

dotenv.config();

const serviceAccount = require("./pharmatrack-firebase.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const PORT = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qfvwawh.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {

    const db = client.db("PharmaTrackDB");

    const shopsCollection = db.collection("shops");
    const usersCollection = db.collection("users");
    const productsCollection = db.collection("products");
    const stockBatchesCollection = db.collection("stockbatches");
    const salesCollection = db.collection("sales");
    const expensesCollection = db.collection("expenses");
    const purchasesCollection = db.collection("purchases");
    const stockMovementsCollection = db.collection("stockmovements");
    const subscriptionsCollection = db.collection("subscriptions");

    // await client.connect();

    // await client.db("admin").command({ ping: 1 });

    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );

    // ======================================================
    // VERIFY FIREBASE TOKEN
    // ======================================================

    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return res.status(401).send({
          message: "Unauthorized access",
        });
      }

      const token = authHeader.split(" ")[1];

      if (!token) {
        return res.status(401).send({
          message: "Unauthorized access",
        });
      }

      try {
        const decoded =
          await admin.auth().verifyIdToken(token);

        const user = await usersCollection.findOne({
          email: decoded.email,
        });

        if (!user) {
          return res.status(404).send({
            message: "User not found",
          });
        }

        req.user = {
          email: user.email,
          shopId: user.shopId,
          role: user.role,
          uid: decoded.uid,
        };

        next();

      } catch (error) {
        console.log(error);

        return res.status(403).send({
          message: "Forbidden access",
        });
      }
    };

    // ======================================================
    // GET PRODUCTS
    // ======================================================

    app.get("/products", verifyFBToken, async (req, res) => {
      try {

        const shopId = req.user.shopId;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || "";

        const skip = (page - 1) * limit;

        // -----------------------------
        // PRODUCT FILTER
        // -----------------------------
        const productFilter = {
          shopId,
          name: {
            $regex: search,
            $options: "i",
          },
        };

        const products = await productsCollection
          .find(productFilter)
          .skip(skip)
          .limit(limit)
          .toArray();

        const productIds = products.map(
          (p) => p._id
        );

        // -----------------------------
        // BATCH FILTER
        // -----------------------------
        let batchFilter = {
          shopId,
          productId: {
            $in: productIds,
          },
        };

        // DATE FILTER
        if (req.query.date) {

          const selectedDate = new Date(req.query.date);

          const start = new Date(selectedDate);
          start.setHours(0, 0, 0, 0);

          const end = new Date(selectedDate);
          end.setHours(23, 59, 59, 999);

          batchFilter.createdAt = {
            $gte: start,
            $lte: end,
          };
        }

        const batches =
          await stockBatchesCollection
            .find(batchFilter)
            .toArray();

        // -----------------------------
        // MERGE PRODUCTS + BATCHES
        // -----------------------------
        const result = products.map((product) => {

          const productBatches = batches
            .filter(
              (b) =>
                b.productId.toString() ===
                product._id.toString()
            )
            .map((b) => ({
              ...b,
              supplierName:
                b.supplierName || "N/A",
            }));

          const totalStock =
            productBatches.reduce(
              (sum, b) =>
                sum + b.quantityRemaining,
              0
            );

          return {
            ...product,
            totalStock,
            batches: productBatches,
          };
        });

        // REMOVE PRODUCTS WITH NO BATCH
        const filteredResult = result.filter(
          (p) => p.batches.length > 0
        );

        res.send({
          data: filteredResult,
          total: filteredResult.length,
          page,
          totalPages: Math.ceil(
            filteredResult.length / limit
          ),
        });

      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: "Error fetching products",
        });
      }
    });

    // ======================================================
    // GET DASHBOARD DATA
    // ======================================================


    app.get("/dashboard/stats",verifyFBToken,async (req, res) => {
        try {
    
          const shopId = req.user.shopId;
    
          let salesFilter = { shopId };
          let expenseFilter = { shopId };
    
          // =====================================
          // DATE FILTER
          // =====================================
    
          if (req.query.date) {
    
            const selectedDate = new Date(
              req.query.date
            );
    
            const start = new Date(selectedDate);
            start.setHours(0, 0, 0, 0);
    
            const end = new Date(selectedDate);
            end.setHours(23, 59, 59, 999);
    
            salesFilter.createdAt = {
              $gte: start,
              $lte: end,
            };
    
            expenseFilter.createdAt = {
              $gte: start,
              $lte: end,
            };
          }
    
          // =====================================
          // MONTH FILTER
          // =====================================
    
          else if (req.query.month) {
    
            const [year, month] =
              req.query.month.split("-");
    
            const start = new Date(
              Number(year),
              Number(month) - 1,
              1
            );
    
            const end = new Date(
              Number(year),
              Number(month),
              0,
              23,
              59,
              59,
              999
            );
    
            salesFilter.createdAt = {
              $gte: start,
              $lte: end,
            };
    
            expenseFilter.createdAt = {
              $gte: start,
              $lte: end,
            };
          }
    
          // =====================================
          // FETCH SALES
          // =====================================
    
          const sales = await salesCollection
            .find(salesFilter)
            .toArray();
    
          // =====================================
          // FETCH EXPENSES
          // =====================================
    
          const expenses = await expensesCollection
            .find(expenseFilter)
            .toArray();
    
          // =====================================
          // TOTALS
          // =====================================
    
          const dailySales = sales.reduce(
            (sum, sale) =>
              sum + Number(sale.grandTotal || 0),
            0
          );
    
          const dailyProfit = sales.reduce(
            (sum, sale) =>
              sum + Number(sale.totalProfit || 0),
            0
          );
    
          const dailyExpenses = expenses.reduce(
            (sum, expense) =>
              sum + Number(expense.amount || 0),
            0
          );
    
          // =====================================
          // SALES PIE CHART
          // =====================================
    
          const monthlySalesChart = [];
    
          sales.forEach((sale) => {
    
            const existing =
              monthlySalesChart.find(
                (item) =>
                  item.name === sale.paymentMethod
              );
    
            if (existing) {
    
              existing.value += Number(
                sale.grandTotal || 0
              );
    
            } else {
    
              monthlySalesChart.push({
                name: sale.paymentMethod,
                value: Number(
                  sale.grandTotal || 0
                ),
              });
            }
          });
    
          // =====================================
          // PROFIT PIE CHART
          // =====================================
    
          const monthlyProfitChart = [];
    
          sales.forEach((sale) => {
    
            const existing =
              monthlyProfitChart.find(
                (item) =>
                  item.name === sale.paymentMethod
              );
    
            if (existing) {
    
              existing.value += Number(
                sale.totalProfit || 0
              );
    
            } else {
    
              monthlyProfitChart.push({
                name: sale.paymentMethod,
                value: Number(
                  sale.totalProfit || 0
                ),
              });
            }
          });
    
          // =====================================
          // RESPONSE
          // =====================================
    
          res.send({
            dailySales,
            dailyProfit,
            dailyExpenses,
    
            netIncome:
              dailyProfit - dailyExpenses,
    
            monthlySalesChart,
            monthlyProfitChart,
          });
    
        } catch (error) {
    
          console.log(error);
    
          res.status(500).send({
            message: "Dashboard fetch failed",
          });
        }
      }
    );

    // ======================================================
    // GET SALES
    // ======================================================

    app.get("/sales", verifyFBToken, async (req, res) => {
      try {

        const shopId = req.user.shopId;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || "";
        const date = req.query.date || "";

        const skip = (page - 1) * limit;

        // =========================
        // FILTER BUILD
        // =========================
        const filter = {
          shopId,
        };

        // CUSTOMER SEARCH
        if (search) {
          filter.customerName = {
            $regex: search,
            $options: "i",
          };
        }

        // DATE FILTER
        if (date) {
          const selectedDate = new Date(date);

          const start = new Date(selectedDate);
          start.setHours(0, 0, 0, 0);

          const end = new Date(selectedDate);
          end.setHours(23, 59, 59, 999);

          filter.createdAt = {
            $gte: start,
            $lte: end,
          };
        }

        // =========================
        // GET SALES
        // =========================
        const sales = await salesCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        // =========================
        // TOTAL COUNT
        // =========================
        const total = await salesCollection.countDocuments(filter);

        res.send({
          data: sales,
          page,
          total,
          totalPages: Math.ceil(total / limit),
        });

      } catch (error) {
        console.log(error);

        res.status(500).send({
          success: false,
          message: "Failed to fetch sales",
        });
      }
    });

    // ======================================================
    // GET EXPENSES
    // ======================================================

    app.get("/expenses", verifyFBToken, async (req, res) => {
      try {
        const result = await expensesCollection
          .find({
            shopId: req.user.shopId,
          })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);

      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: "Failed to fetch expenses",
        });
      }
    });


    // DELETE EXPENSE
    app.delete("/expenses/:id", verifyFBToken, async (req, res) => {
      try {
        const result = await expensesCollection.deleteOne({
          _id: new ObjectId(req.params.id),
          shopId: req.user.shopId,
        });

        res.send({
          success: true,
          result,
        });

      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: "Delete failed",
        });
      }
    });

    // ======================================================
    // POST EXPENSES 
    // ======================================================

    app.post("/expenses", verifyFBToken, async (req, res) => {
      try {
        const shopId = req.user.shopId;

        const expense = {
          shopId,
          title: req.body.title,
          amount: Number(req.body.amount),
          type: req.body.type,
          category: req.body.category,
          note: req.body.note || "",
          createdAt: new Date(),
        };

        const result = await expensesCollection.insertOne(expense);

        res.send({
          success: true,
          message: "Expense added",
          result,
        });

      } catch (error) {
        console.log(error);

        res.status(500).send({
          success: false,
          message: "Failed to add expense",
        });
      }
    });

    // ======================================================
    // REGISTER
    // ======================================================

    app.post("/register", async (req, res) => {
      try {

        const userData = req.body;

        const existingUser =
          await usersCollection.findOne({
            email: userData.email,
          });

        if (existingUser) {
          return res.send({
            message: "User already exists",
          });
        }

        // CREATE SHOP
        const shop = {
          name: userData.shopName,
          ownerName: userData.ownerName,
          email: userData.email,
          subscriptionPlan: "free",
          createdAt: new Date(),
        };

        const shopResult =
          await shopsCollection.insertOne(shop);

        // CREATE USER
        const user = {
          name: userData.ownerName,
          email: userData.email,
          firebaseUID: userData.firebaseUID,
          role: "admin",
          shopId: shopResult.insertedId,
          createdAt: new Date(),
        };

        const result =
          await usersCollection.insertOne(user);

        res.send({
          success: true,
          message: "User registered successfully",
          result,
        });

      } catch (error) {
        console.log(error);

        res.status(500).send({
          success: false,
          message: "Registration failed",
        });
      }
    });

    // ======================================================
    // ADD PRODUCT
    // ======================================================

    app.post("/products", verifyFBToken, async (req, res) => {

      const product = req.body;

      const result =
        await productsCollection.insertOne({
          ...product,
          shopId: req.user.shopId,
          createdAt: new Date(),
        });

      res.send(result);
    });

    // ======================================================
    // ADD STOCK
    // ======================================================

    app.post("/stock/add", verifyFBToken, async (req, res) => {
      try {

        const {
          productName,
          supplierName,
          quantityPurchased,
          costPrice,
          sellingPrice,
        } = req.body;

        const shopId = req.user.shopId;

        // -----------------------------
        // PRODUCT
        // -----------------------------
        let product =
          await productsCollection.findOne({
            shopId,
            name: productName,
          });

        // CREATE PRODUCT IF NOT EXISTS
        if (!product) {

          const productResult =
            await productsCollection.insertOne({
              shopId,
              name: productName,
              createdAt: new Date(),
            });

          product = {
            _id: productResult.insertedId,
          };
        }

        // -----------------------------
        // STOCK BATCH
        // -----------------------------
        const batchNumber = `BATCH-${Date.now()}`;

        await stockBatchesCollection.insertOne({

          shopId,

          productId: product._id,

          productName: productName,

          quantityPurchased:
            Number(quantityPurchased),

          quantityRemaining:
            Number(quantityPurchased),

          costPrice: Number(costPrice),

          sellingPrice:
            Number(sellingPrice),

          supplierName:
            supplierName || "N/A",

          batchNumber,

          createdAt: new Date(),
        });

        // -----------------------------
        // PURCHASE RECORD
        // -----------------------------
        await purchasesCollection.insertOne({

          shopId,

          productId: product._id,

          productName,

          supplierName:
            supplierName || "N/A",

          quantity:
            Number(quantityPurchased),

          costPrice:
            Number(costPrice),

          totalCost:
            Number(quantityPurchased) *
            Number(costPrice),

          createdAt: new Date(),
        });

        res.send({
          success: true,
          message:
            "Stock + Purchase recorded successfully",
        });

      } catch (error) {

        console.log(error);

        res.status(500).send({
          success: false,
          message: "Stock add failed",
        });
      }
    });

    // ======================================================
    // ADD SALES
    // ======================================================

    app.post("/sales/create", verifyFBToken, async (req, res) => {
      try {
        const {
          customerName,
          customerNumber,
          paymentMethod,
          discountPercent, // ✅ percent based discount
          items,
          subtotal,
          grandTotal,
        } = req.body;
    
        const shopId = req.user.shopId;
    
        let saleItems = [];
        let totalProfit = 0;
    
        // ===========================
        // 1. PROCESS ITEMS (FIFO)
        // ===========================
        for (const item of items) {
          const productId = new ObjectId(item.productId);
          const productName = item.productName;
          let quantityToSell = Number(item.quantity);
          const sellingPrice = Number(item.sellingPrice);
    
          const batches = await stockBatchesCollection
            .find({
              shopId,
              productId,
              quantityRemaining: { $gt: 0 },
            })
            .sort({ createdAt: 1 })
            .toArray();
    
          for (const batch of batches) {
            if (quantityToSell <= 0) break;
    
            const available = batch.quantityRemaining;
            const take = Math.min(available, quantityToSell);
    
            const costPriceAtSale = batch.costPrice;
    
            const revenue = sellingPrice * take;
    
            saleItems.push({
              productId,
              productName,
              batchId: batch._id,
              quantity: take,
              sellingPrice,
              costPriceAtSale,
              revenue, // ✅ IMPORTANT
              profit: 0, // will calculate later
            });
    
            // reduce stock
            await stockBatchesCollection.updateOne(
              { _id: batch._id },
              { $inc: { quantityRemaining: -take } }
            );
    
            quantityToSell -= take;
          }
    
          if (quantityToSell > 0) {
            return res.status(400).send({
              success: false,
              message: "Insufficient stock for product",
            });
          }
        }
    
        // ===========================
        // 2. CALCULATE TOTAL REVENUE
        // ===========================
        const totalRevenue = saleItems.reduce(
          (sum, i) => sum + i.revenue,
          0
        );
    
        // ===========================
        // 3. CALCULATE DISCOUNT
        // ===========================
        const discountAmount =
          (totalRevenue * Number(discountPercent || 0)) / 100;
    
        // ===========================
        // 4. DISTRIBUTE DISCOUNT + PROFIT
        // ===========================
        for (let item of saleItems) {
          const itemShare =
            totalRevenue === 0 ? 0 : item.revenue / totalRevenue;
    
          const itemDiscount = discountAmount * itemShare;
    
          const cost = item.costPriceAtSale * item.quantity;
    
          item.profit =
            item.revenue - itemDiscount - cost;
    
          totalProfit += item.profit;
        }
    
        // ===========================
        // 5. CREATE SALE
        // ===========================
        const sale = {
          shopId,
    
          customerName: customerName || "Walk-in",
          customerNumber: customerNumber || null,
    
          paymentMethod,
    
          discountPercent: Number(discountPercent || 0),
          discountAmount,
    
          items: saleItems,
    
          subtotal: Number(subtotal),
          grandTotal: Number(grandTotal),
    
          totalProfit,
    
          createdAt: new Date(),
        };
    
        const result = await salesCollection.insertOne(sale);
    
        res.send({
          success: true,
          message: "Sale completed successfully",
          saleId: result.insertedId,
        });
      } catch (error) {
        console.log(error);
    
        res.status(500).send({
          success: false,
          message: "Sale failed",
        });
      }
    });




 // ======================================================
    // UPDATE PRODUCT
    // ======================================================
    app.get("/products/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const shopId = req.user.shopId;
    
        const product = await productsCollection.findOne({
          _id: new ObjectId(id),
          shopId,
        });
    
        const batches = await stockBatchesCollection
          .find({
            shopId,
            productId: new ObjectId(id),
          })
          .toArray();
    
        res.send({
          ...product,
          batches,
        });
      } catch (error) {
        console.log(error);
    
        res.status(500).send({
          message: "Failed to get product",
        });
      }
    });


// ======================================================
    // UPDATE BATCH
    // ======================================================
    app.put("/batches/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
    
        const {
          costPrice,
          sellingPrice,
          quantityRemaining,
        } = req.body;
    
        const shopId = req.user.shopId;
    
        const result = await stockBatchesCollection.updateOne(
          {
            _id: new ObjectId(id),
            shopId,
          },
          {
            $set: {
              costPrice: Number(costPrice),
              sellingPrice: Number(sellingPrice),
              quantityRemaining: Number(quantityRemaining),
            },
          }
        );
    
        res.send({
          success: true,
          message: "Batch updated successfully",
          result,
        });
      } catch (error) {
        console.log(error);
    
        res.status(500).send({
          success: false,
          message: "Batch update failed",
        });
      }
    });

    // ======================================================
    // DELETE PRODUCT
    // ======================================================


    app.delete("/products/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const shopId = req.user.shopId;

      await productsCollection.deleteOne({
        _id: new ObjectId(id),
        shopId,
      });

      await stockBatchesCollection.deleteMany({
        productId: new ObjectId(id),
        shopId,
      });

      res.send({ success: true });
    });

    // ======================================================
    // DELETE PRODUCT BATCH
    // ======================================================

    app.delete("/batches/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const shopId = req.user.shopId;

      await stockBatchesCollection.deleteOne({
        _id: new ObjectId(id),
        shopId,
      });

      res.send({ success: true });
    });


 // ======================================================
    // DELETE SALE 
    // ======================================================

app.delete("/sales/:id", verifyFBToken, async (req, res) => {
  try {
    const saleId = new ObjectId(req.params.id);
    const shopId = req.user.shopId;

    // ===========================
    // 1. FIND SALE
    // ===========================
    const sale = await salesCollection.findOne({
      _id: saleId,
      shopId,
    });

    if (!sale) {
      return res.status(404).send({
        success: false,
        message: "Sale not found",
      });
    }

    // ===========================
    // 2. RESTORE STOCK (FIFO REVERSE)
    // ===========================
    for (const item of sale.items) {
      const productId = new ObjectId(item.productId);
      let quantityToRestore = Number(item.quantity);

      // restore into batches (reverse FIFO is fine for simple systems)
      const batches = await stockBatchesCollection
        .find({
          shopId,
          productId,
        })
        .sort({ createdAt: -1 }) // reverse order
        .toArray();

      for (const batch of batches) {
        if (quantityToRestore <= 0) break;

        const restoreQty = quantityToRestore;

        await stockBatchesCollection.updateOne(
          { _id: batch._id },
          {
            $inc: {
              quantityRemaining: restoreQty,
            },
          }
        );

        quantityToRestore -= restoreQty;
      }
    }

    // ===========================
    // 3. DELETE SALE
    // ===========================
    await salesCollection.deleteOne({
      _id: saleId,
      shopId,
    });

    res.send({
      success: true,
      message: "Sale deleted successfully and stock restored",
    });

  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Failed to delete sale",
    });
  }
});






  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

// ======================================================
// ROOT
// ======================================================

app.get("/", (req, res) => {
  res.send("Server is running!");
});

// ======================================================
// START SERVER
// ======================================================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});