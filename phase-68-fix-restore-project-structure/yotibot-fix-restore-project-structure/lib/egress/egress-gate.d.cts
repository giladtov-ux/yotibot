interface EgressGateStatus {
  approved: boolean;
  tripped: boolean;
  activeRequests: number;
  targetCount: number;
}

interface EgressGateHandle {
  policy: {
    browserOrigins?: readonly string[];
  };
  status(): EgressGateStatus;
  onTrip(listener: () => void): () => void;
  registerChild(child: {
    kill(signal?: NodeJS.Signals): boolean;
    once(event: string, listener: (...args: unknown[]) => void): unknown;
  }): () => void;
}

declare const egressGate: {
  getProcessEgressGate(): EgressGateHandle | undefined;
  browserConnectSource(policy?: { browserOrigins?: readonly string[] }): string;
};

export = egressGate;
