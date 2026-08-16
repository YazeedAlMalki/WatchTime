import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";
import trackingRouter from "./tracking";
import safetyRouter from "./safety";
import miscRouter from "./misc";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(catalogRouter);
router.use(trackingRouter);
router.use(safetyRouter);
router.use(miscRouter);
router.use("/admin", adminRouter);

export default router;
