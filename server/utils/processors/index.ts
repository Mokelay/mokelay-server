import { apiJsonWhenPublishedProcessor } from './api_json_when_published'
import { emailCheckProcessor } from './email_check'
import { envValueProcessor } from './env_value'
import { eqProcessor } from './eq'
import { equalsProcessor } from './equals'
import { hashCheckProcessor } from './hash_check'
import { hashMakeProcessor } from './hash_make'
import { isNotNullProcessor } from './is_not_null'
import { isNullProcessor } from './is_null'
import { maxProcessor } from './max'
import { minProcessor } from './min'
import { notNullProcessor } from './not_null'
import { numberCheckProcessor } from './number_check'
import { regexProcessor } from './regex'
import { trimProcessor } from './trim'
import { type ProcessorExecutor } from './shared'

export const processorExecutors: Record<string, ProcessorExecutor> = {
  trim: trimProcessor,
  is_not_null: isNotNullProcessor,
  is_null: isNullProcessor,
  not_null: notNullProcessor,
  email_check: emailCheckProcessor,
  number_check: numberCheckProcessor,
  eq: eqProcessor,
  equals: equalsProcessor,
  env_value: envValueProcessor,
  api_json_when_published: apiJsonWhenPublishedProcessor,
  min: minProcessor,
  max: maxProcessor,
  regex: regexProcessor,
  hash_make: hashMakeProcessor,
  hash_check: hashCheckProcessor,
}
