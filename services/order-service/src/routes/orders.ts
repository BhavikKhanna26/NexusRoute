import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getNexusrouteDb } from '../db/mongo';
import { publishOrderCreated } from '../kafka/producer';
import { assertValidTransition, OrderStatus } from '../domain/order.statemachine';
import { logger } from '../logger';
import type { OrderCreatedEvent } from '@nexusroute/contracts';

export const ordersRouter = Router();

const CreateOrderSchema = z.object({
  seller_id: z.string().min(1),
  origin_pincode: z.string().regex(/^\d{6}$/, 'Must be a 6-digit pincode'),
  destination_pincode: z.string().regex(/^\d{6}$/, 'Must be a 6-digit pincode'),
  weight_grams: z.number().int().positive(),
  service_type: z.enum(['SURFACE', 'EXPRESS', 'OVERNIGHT']),
  payment_method: z.enum(['COD', 'PREPAID']),
  promised_sla_days: z.number().int().min(1).max(30),
});

// POST /orders — create a new order
ordersRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }

  const input = parsed.data;
  const order_id = `ORD-${uuidv4()}`;
  const awb_number = `RS${Date.now()}IN`;
  const trace_id = (req.headers['x-trace-id'] as string) ?? uuidv4();

  const db = getNexusrouteDb();
  const now = new Date();

  const order = {
    order_id,
    awb_number,
    ...input,
    status: 'PENDING' as OrderStatus,
    created_at: now,
    updated_at: now,
  };

  await db.collection('oms_shipments').insertOne(order);

  const event: OrderCreatedEvent = {
    event_id: uuidv4(),
    event_type: 'ORDER_CREATED',
    order_id,
    awb_number,
    seller_id: input.seller_id,
    origin_pincode: input.origin_pincode,
    destination_pincode: input.destination_pincode,
    weight_grams: input.weight_grams,
    service_type: input.service_type,
    payment_method: input.payment_method,
    promised_sla_days: input.promised_sla_days,
    created_at: now.toISOString(),
    trace_id,
  };

  await publishOrderCreated(event);

  logger.info({ order_id, awb_number, trace_id }, 'Order created');
  return res.status(201).json({ order_id, awb_number, status: 'PENDING', trace_id });
});

// GET /orders/:id
ordersRouter.get('/:id', async (req: Request, res: Response) => {
  const db = getNexusrouteDb();
  const order = await db.collection('oms_shipments').findOne(
    { order_id: req.params.id },
    { projection: { _id: 0 } }
  );
  if (!order) return res.status(404).json({ error: 'Order not found' });
  return res.json(order);
});

// GET /orders/:awbNumber/status
ordersRouter.get('/:awbNumber/status', async (req: Request, res: Response) => {
  const db = getNexusrouteDb();
  const order = await db.collection('oms_shipments').findOne(
    { awb_number: req.params.awbNumber },
    { projection: { _id: 0, awb_number: 1, status: 1, carrier_code: 1 } }
  );
  if (!order) return res.status(404).json({ error: 'Order not found' });
  return res.json(order);
});

// PATCH /orders/:id/status — internal endpoint (called by consumers, not the Gateway)
const StatusUpdateSchema = z.object({
  status: z.enum(['PENDING', 'CARRIER_ASSIGNED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'NDR', 'RTO_INITIATED', 'RTO_DELIVERED']),
});

ordersRouter.patch('/:id/status', async (req: Request, res: Response) => {
  const parsed = StatusUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });

  const db = getNexusrouteDb();
  const order = await db.collection('oms_shipments').findOne({ order_id: req.params.id });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  try {
    assertValidTransition(order.status as OrderStatus, parsed.data.status);
  } catch (err: unknown) {
    if (err instanceof Error) {
      return res.status(422).json({ error: err.message });
    }
    throw err;
  }

  await db.collection('oms_shipments').updateOne(
    { order_id: req.params.id },
    { $set: { status: parsed.data.status, updated_at: new Date() } }
  );

  return res.json({ order_id: req.params.id, status: parsed.data.status });
});
