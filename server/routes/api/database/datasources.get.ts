import { defineEventHandler } from 'h3'
import { listConfiguredDatasources } from '../../../utils/db'

export default defineEventHandler(() => ({
  datasources: listConfiguredDatasources(),
}))
