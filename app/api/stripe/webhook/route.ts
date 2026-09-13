import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !webhookSecret) {
    return NextResponse.json(
      {
        error: 'Stripe webhook is not configured yet',
      },
      {
        status: 503,
      }
    );
  }

  const stripe = new Stripe(stripeSecretKey);

  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      {
        error: 'Missing stripe-signature header',
      },
      {
        status: 400,
      }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    );
  } catch {
    return NextResponse.json(
      {
        error: 'Invalid Stripe webhook signature',
      },
      {
        status: 400,
      }
    );
  }

  switch (event.type) {
    case 'checkout.session.completed':
      console.log('Stripe checkout completed');
      break;

    case 'payment_intent.succeeded':
      console.log('Stripe payment succeeded');
      break;

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }

  return NextResponse.json({
    received: true,
  });
}
