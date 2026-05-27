import { defineNitroConfig } from 'nitropack/config'

export default defineNitroConfig({
  srcDir: 'server',
  compatibilityDate: '2026-04-30',
  preset: process.env.NITRO_PRESET || 'vercel',
  externals: {
    inline: ['mokelay-server-core'],
  },
})
