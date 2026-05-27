import { defineEventHandler } from 'h3'
import { applyCors } from 'mokelay-server-core/utils/cors'

export default defineEventHandler((event) => applyCors(event))
