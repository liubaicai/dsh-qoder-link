import { type BridgeEvent } from './protocol.ts';
import { type QoderRequest } from './runner.ts';
/**
 * Native tools remain entirely inside Qoder. ACP notifications are display
 * events, never tool requests to execute or replay in the host. Each invocation
 * creates a fresh process/session; request.prompt contains the complete history.
 */
export declare function runQoderAcp(request: QoderRequest): AsyncGenerator<BridgeEvent>;
