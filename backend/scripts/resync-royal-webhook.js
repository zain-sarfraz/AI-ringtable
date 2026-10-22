import "../src/loadEnv.js";
import { syncRestaurantMenuToSynthflow } from "../src/fns/syncRestaurantMenuToSynthflow.js";

const rid = "94854968-6a74-4f5e-906f-f73a0423328e";
const res = {
  set() {
    return this;
  },
  status(c) {
    this.code = c;
    return this;
  },
  json(b) {
    console.log(JSON.stringify(b, null, 2));
    return this;
  },
};
await syncRestaurantMenuToSynthflow({ body: { restaurant_id: rid } }, res);
process.exit(0);
