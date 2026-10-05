import { defineBuilderConfig } from '@afilmory/builder'

export default defineBuilderConfig(() => ({
  storage: {
    provider: 's3',
    bucket: process.env.S3_BUCKET!,
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION || 'auto',
    prefix: process.env.S3_PREFIX || 'photos/',
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    customDomain: process.env.S3_CUSTOM_DOMAIN,
  },
}))
