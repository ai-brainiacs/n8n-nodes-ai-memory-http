import { BufferMemory, BufferWindowMemory } from 'langchain/memory';
import { BaseChatMessageHistory } from '@langchain/core/chat_history';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import {
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';
import fetch from 'node-fetch';

//import { getConnectionHintNoticeField } from '@utils/sharedFields';

export class MemoryHTTPChat implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HTTP Chat Memory',
		name: 'memoryHTTPChat',
		icon: 'file:http.svg',
		group: ['transform'],
		version: [1, 1.1, 1.2, 1.3, 1.4, 1.5],
		description: 'Stores the chat history via HTTP.',
		defaults: {
			name: 'HTTP Chat Memory',
		},
		credentials: [
			{
				name: 'http',
				required: true,
			},
		],
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Memory'],
				Memory: ['Other memories'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://github.com/ai-brainiacs/n8n-nodes-ai-memory-http',
					},
				],
			},
		},

		inputs: [],
		//@ts-ignore
		outputs: ["ai_memory"],
		outputNames: ['Memory'],
		properties: [
			//getConnectionHintNoticeField(["ai_agent"]),
			{
				displayName: 'Channel ID',
				name: 'channelId',
				type: 'string',
				default: 'chat_history',
				description: 'The Channel ID to store the chat memory',
			},
			{
				displayName: 'JSON Context',
				name: 'context',
				type: 'string',
				default: '{}',
				description:
					'JSON context for the chat memory.',
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials('http');
		//const nodeVersion = this.getNode().typeVersion;
		
		const httpChatHistory = new HTTPChatMessageHistory({
			channelId: this.getNodeParameter('channelId', itemIndex) as string,
			context : this.getNodeParameter('context', itemIndex) as string,
			connection: {
				host: credentials.host as string,
				port: credentials.port as number,
				token: credentials.token as string,
			}
		});

		const memClass = this.getNode().typeVersion < 1.3 ? BufferMemory : BufferWindowMemory;
		const kOptions =
			this.getNode().typeVersion < 1.3
				? {}
				: { k: this.getNodeParameter('contextWindowLength', itemIndex) };

		const memory = new memClass({
			memoryKey: 'chat_history',
			chatHistory: httpChatHistory,
			returnMessages: true,
			inputKey: 'input',
			outputKey: 'output',
			...kOptions,
		});

		async function closeFunction() {}

		return {
			closeFunction,
			response: memory,
		};
	}
}

interface HTTPChatMessageHistoryInput {
	channelId: string;
	context:any
	connection: {
		host: string;
		port: number;
		token: string;
	};
}


export class HTTPChatMessageHistory extends BaseChatMessageHistory {
	public lc_namespace: string[] = ['brainiacsai.com', 'n8n-nodes-ai-memory-http', 'HTTPChatMessageHistory'];
	public messages: Record<string, BaseMessage[]> = {};

	constructor(fields: HTTPChatMessageHistoryInput) {
		super();
		this.lc_kwargs = fields;
	}

	async getMessages(): Promise<BaseMessage[]> {
		const { context, connection, channelId } = this.lc_kwargs as HTTPChatMessageHistoryInput;
		const url = `http://${connection.host}:${connection.port}/messages?channelId=${channelId}`;
		const response = await fetch(url, {
			headers: {
				'Accept': 'application/json',
				'Authorization': `Bearer ${connection.token}`,
				'X-context': context ? JSON.stringify(context) : '{}'
			}
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch messages: ${response.statusText}`);
		}
		const data = await response.json() as { messages: any[] };

		this.messages[channelId] = (data.messages || []).map((msg: any) => {
			switch (msg.role) {
				case 'human':
					return new HumanMessage({content:msg.content, response_metadata: msg.metadata});
				case 'ai':
					return new AIMessage({content:msg.content, response_metadata: msg.metadata});
				case 'system':
					return new SystemMessage({content:msg.content, response_metadata: msg.metadata});
				case 'tool':
					return new ToolMessage({tool_call_id:"123",content:msg.content, response_metadata: msg.metadata});
				default:
					//console.log('Unknown message role: ', msg.role, channelId);
					return new HumanMessage({content:msg.content, response_metadata: msg.metadata});
			}
		});

		return this.messages[channelId] || [];
	}

	async addMessage(message: BaseMessage): Promise<void> {
		this.sendMessages([message]);
	}

	async addMessages(messages: BaseMessage[]): Promise<void> {
		this.sendMessages(messages);
	}

	async addUserMessage(text: string): Promise<void> {
		this.sendMessages([new HumanMessage({ content: text })]);
	}

	async addAIChatMessage(text: string): Promise<void> {
		this.sendMessages([new AIMessage({ content: text })]);
	}

	async clear(): Promise<void> {
		//const { channelId } = this.lc_kwargs as HTTPChatMessageHistoryInput;
		//this.messages[channelId] = [];
	}

	async sendMessages(messages: BaseMessage[]){
		const { context, connection, channelId } = this.lc_kwargs as HTTPChatMessageHistoryInput;
		const url = `http://${connection.host}:${connection.port}/messages?channelId=${channelId}`;

		const response = await fetch(url, {
			method: 'POST',
			headers: { 
				'Authorization': `Bearer ${connection.token}`,
				'Content-Type': 'application/json', 
				'X-context': context ? JSON.stringify(context) : '{}'
			},
			body: JSON.stringify(messages.map(msg => { return { type: msg.getType(), content: msg.content, metadata: msg.response_metadata } })),
		});
		if (!response.ok) {
			throw new Error(`Failed to add messages: ${response.statusText}`);
		}
		this.messages[channelId].push(...messages);
	}
}

