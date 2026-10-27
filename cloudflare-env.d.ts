declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ORBITA_CREDENTIALS_KEY?: string;
  }
}
