export type SerializedTerminalEvent =
	| {
			type: "terminal_data";
			terminalId: string;
			sessionId: string;
			data: string;
	  }
	| {
			type: "terminal_exit";
			terminalId: string;
			sessionId: string;
			exitCode: number;
			signal?: number;
	  };
