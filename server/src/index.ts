import app from "./app-server.js";

const PORT = Number(process.env.PORT ?? 3001);

app.listen(PORT, () => {
  console.log(`ByteBites API listening on http://localhost:${PORT}`);
});
