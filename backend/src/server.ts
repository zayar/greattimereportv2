import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { env } from "./config/env.js";
import { ensureFirebaseAdmin } from "./config/firebase.js";
import { errorHandler } from "./middleware/error-handler.js";
import { initializeTelegramRuntime } from "./services/telegram/runtime.service.js";

ensureFirebaseAdmin();

const app = express();
const allowedOrigins = env.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));

app.use("/api", routes);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`GT_V2Report backend listening on http://localhost:${env.PORT}`);
  void initializeTelegramRuntime();
});
