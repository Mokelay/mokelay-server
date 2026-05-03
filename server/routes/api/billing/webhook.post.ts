import { createError, defineEventHandler, getHeader, readRawBody } from 'h3'

export default defineEventHandler(async (event) => {
  const body = await readRawBody(event)
  const signature = getHeader(event, 'stripe-signature')

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return {
      received: true,
      mode: 'placeholder',
      message: 'Stripe webhook secret is not configured yet.',
    }
  }

  if (!body || !signature) {
    throw createError({
      statusCode: 400,
      message: 'Missing Stripe webhook body or signature.',
    })
  }

  return {
    received: true,
    mode: 'configured',
    message: 'Stripe signature verification will be implemented with Billing phase two.',
  }
})
