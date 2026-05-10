import { defineEventHandler, setResponseStatus, type EventHandler, type H3Event } from 'h3'
import { toMokelayErrorResponse } from './mokelay-error'

type RouteHandler<T> = (event: H3Event) => Promise<T> | T

export function ok<T>(data: T) {
  return {
    ok: true,
    data,
  }
}

export function defineOrchestrationApiRoute<T>(handler: RouteHandler<T>): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      return ok(await handler(event))
    } catch (error) {
      setResponseStatus(event, 200)
      return toMokelayErrorResponse(error)
    }
  })
}
