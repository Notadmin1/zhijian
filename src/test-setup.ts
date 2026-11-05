import 'fake-indexeddb/auto'
import { Blob, File } from 'node:buffer'
Object.assign(globalThis, { Blob, File })
