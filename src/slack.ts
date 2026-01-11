/**
 * Slack Integration
 * Creates channels for agent-task communication
 */

interface SlackChannel {
  id: string;
  name: string;
}

interface SlackMessage {
  ts: string;
  user?: string;
  text: string;
  bot_id?: string;
}

interface SlackResponse {
  ok: boolean;
  channel?: SlackChannel;
  channels?: Array<{ id: string; name: string }>;
  messages?: SlackMessage[];
  error?: string;
}

export class SlackService {
  private token: string | null = null;
  private defaultChannelId: string | null = null;

  // Channel-to-task mapping for routing messages
  private channelTaskMap: Map<string, { taskId: string; agentName: string }> = new Map();

  // Track bot user ID to filter out bot messages
  private botUserId: string | null = null;

  constructor() {
    this.token = process.env.SLACK_BOT_TOKEN || null;
    this.defaultChannelId = process.env.SLACK_CHANNEL_ID || null;

    if (this.token) {
      console.log('[Slack] Service initialized');
      // Get bot user ID on startup
      this.getBotUserId().catch(() => {});
    } else {
      console.log('[Slack] No SLACK_BOT_TOKEN, Slack features disabled');
    }
  }

  /**
   * Get the bot's user ID from Slack
   */
  private async getBotUserId(): Promise<string | null> {
    if (this.botUserId) return this.botUserId;
    if (!this.token) return null;

    try {
      const response = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json() as { ok: boolean; user_id?: string };
      if (data.ok && data.user_id) {
        this.botUserId = data.user_id;
        console.log('[Slack] Bot user ID:', this.botUserId);
        return this.botUserId;
      }
    } catch (error) {
      console.error('[Slack] Failed to get bot user ID:', error);
    }
    return null;
  }

  /**
   * Check if a message is from the bot itself
   */
  isBotMessage(userId: string): boolean {
    return userId === this.botUserId;
  }

  /**
   * Register a channel-task mapping
   */
  registerChannel(channelId: string, taskId: string, agentName: string): void {
    this.channelTaskMap.set(channelId, { taskId, agentName });
    console.log(`[Slack] Registered channel ${channelId} -> task ${taskId} (${agentName})`);
  }

  /**
   * Get task info for a channel
   */
  getTaskForChannel(channelId: string): { taskId: string; agentName: string } | null {
    return this.channelTaskMap.get(channelId) || null;
  }

  /**
   * Unregister a channel mapping (when task completes)
   */
  unregisterChannel(channelId: string): void {
    this.channelTaskMap.delete(channelId);
  }

  isEnabled(): boolean {
    return this.token !== null;
  }

  /**
   * Create a channel for an agent task
   * Channel name format: task-{agentName}-{taskId}
   * @param startedByUserId - Optional Slack user ID to tag and invite
   */
  async createTaskChannel(
    agentName: string,
    taskId: string,
    taskTitle: string,
    startedByUserId?: string
  ): Promise<SlackChannel | null> {
    if (!this.token) return null;

    // Slack channel names: lowercase, no spaces, max 80 chars
    const channelName = this.sanitizeChannelName(`task-${agentName}-${taskId}`);

    try {
      // Create the channel
      const createResponse = await this.apiCall('conversations.create', {
        name: channelName,
        is_private: false,
      });

      if (!createResponse.ok) {
        // Channel might already exist
        if (createResponse.error === 'name_taken') {
          console.log(`[Slack] Channel ${channelName} already exists`);
          const existingChannel = await this.findChannel(channelName);
          // Register mapping for existing channel too
          if (existingChannel) {
            this.registerChannel(existingChannel.id, taskId, agentName);
          }
          return existingChannel;
        }
        console.error('[Slack] Failed to create channel:', createResponse.error);
        return null;
      }

      const channel = createResponse.channel as SlackChannel;
      console.log(`[Slack] Created channel: #${channelName}`);

      // Register channel-task mapping for message routing
      this.registerChannel(channel.id, taskId, agentName);

      // Invite the user who started the task
      if (startedByUserId) {
        await this.inviteUserToChannel(channel.id, startedByUserId);
      }

      // Post initial message with task context and tag the user
      await this.postMessage(
        channel.id,
        this.formatTaskStartMessage(agentName, taskTitle, taskId, startedByUserId)
      );

      return channel;
    } catch (error) {
      console.error('[Slack] Error creating channel:', error);
      return null;
    }
  }

  /**
   * Invite a user to a channel
   */
  async inviteUserToChannel(channelId: string, userId: string): Promise<boolean> {
    if (!this.token) return false;

    try {
      const response = await this.apiCall('conversations.invite', {
        channel: channelId,
        users: userId,
      });

      if (response.ok) {
        console.log(`[Slack] Invited user ${userId} to channel`);
      }
      return response.ok;
    } catch (error) {
      console.error('[Slack] Error inviting user:', error);
      return false;
    }
  }

  /**
   * Post a message to a channel
   */
  async postMessage(channelId: string, text: string, blocks?: unknown[]): Promise<boolean> {
    if (!this.token) return false;

    try {
      const response = await this.apiCall('chat.postMessage', {
        channel: channelId,
        text,
        blocks,
      });

      return response.ok;
    } catch (error) {
      console.error('[Slack] Error posting message:', error);
      return false;
    }
  }

  /**
   * Post a message to the default channel
   */
  async notify(message: string): Promise<boolean> {
    if (!this.token || !this.defaultChannelId) return false;
    return this.postMessage(this.defaultChannelId, message);
  }

  /**
   * Update channel topic with task status
   */
  async updateChannelTopic(channelId: string, topic: string): Promise<boolean> {
    if (!this.token) return false;

    try {
      const response = await this.apiCall('conversations.setTopic', {
        channel: channelId,
        topic: topic.substring(0, 250), // Slack topic limit
      });

      return response.ok;
    } catch (error) {
      console.error('[Slack] Error updating topic:', error);
      return false;
    }
  }

  /**
   * Archive a channel when task is complete
   */
  async archiveChannel(channelId: string): Promise<boolean> {
    if (!this.token) return false;

    try {
      const response = await this.apiCall('conversations.archive', {
        channel: channelId,
      });

      return response.ok;
    } catch (error) {
      console.error('[Slack] Error archiving channel:', error);
      return false;
    }
  }

  /**
   * Join a channel (required before reading messages)
   */
  async joinChannel(channelId: string): Promise<boolean> {
    if (!this.token) return false;

    try {
      const response = await this.apiCall('conversations.join', {
        channel: channelId,
      });

      if (response.ok) {
        console.log(`[Slack] Joined channel ${channelId}`);
      }
      return response.ok;
    } catch (error) {
      console.error('[Slack] Error joining channel:', error);
      return false;
    }
  }

  /**
   * Read messages from a channel
   * @param channelId - The channel to read from
   * @param limit - Maximum number of messages to retrieve (default: 20)
   * @param oldest - Only get messages after this timestamp
   */
  async readMessages(
    channelId: string,
    limit: number = 20,
    oldest?: string
  ): Promise<Array<{ user: string; text: string; ts: string; isBot: boolean }>> {
    if (!this.token) return [];

    try {
      const params: Record<string, unknown> = {
        channel: channelId,
        limit,
      };
      if (oldest) {
        params.oldest = oldest;
      }

      let response = await this.apiCall('conversations.history', params);

      // Auto-join if not in channel
      if (!response.ok && response.error === 'not_in_channel') {
        await this.joinChannel(channelId);
        response = await this.apiCall('conversations.history', params);
      }

      if (!response.ok || !response.messages) {
        console.error('[Slack] Failed to read messages:', response.error);
        return [];
      }

      // Get user info for each message
      const messages = await Promise.all(
        response.messages.map(async (msg) => {
          const userName = msg.user ? await this.getUserName(msg.user) : 'Bot';
          return {
            user: userName,
            text: msg.text,
            ts: msg.ts,
            isBot: !!msg.bot_id,
          };
        })
      );

      // Return in chronological order (oldest first)
      return messages.reverse();
    } catch (error) {
      console.error('[Slack] Error reading messages:', error);
      return [];
    }
  }

  /**
   * Get user-only messages (exclude bot messages)
   */
  async readUserMessages(
    channelId: string,
    limit: number = 10,
    oldest?: string
  ): Promise<Array<{ user: string; text: string; ts: string }>> {
    const messages = await this.readMessages(channelId, limit * 2, oldest);
    return messages
      .filter(m => !m.isBot)
      .slice(0, limit)
      .map(({ user, text, ts }) => ({ user, text, ts }));
  }

  /**
   * Format messages for agent context
   */
  async getChannelContext(channelId: string, limit: number = 10): Promise<string> {
    const messages = await this.readUserMessages(channelId, limit);

    if (messages.length === 0) {
      return '';
    }

    const formatted = messages
      .map(m => `**${m.user}**: ${m.text}`)
      .join('\n');

    return `\n## Team Messages\nRecent messages from the team in your task channel:\n${formatted}`;
  }

  /**
   * Get user display name from user ID
   */
  private userCache: Map<string, string> = new Map();

  async getUserName(userId: string): Promise<string> {
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!;
    }

    try {
      const response = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
        },
      });

      const data = await response.json() as { ok: boolean; user?: { real_name?: string; name?: string } };

      if (data.ok && data.user) {
        const name = data.user.real_name || data.user.name || userId;
        this.userCache.set(userId, name);
        return name;
      }
    } catch (error) {
      console.error('[Slack] Error getting user info:', error);
    }

    return userId;
  }

  /**
   * Find a channel by name
   */
  private async findChannel(name: string): Promise<SlackChannel | null> {
    try {
      const response = await this.apiCall('conversations.list', {
        types: 'public_channel',
        limit: 1000,
      });

      if (!response.ok) return null;

      const channels = response.channels as Array<{ id: string; name: string }>;
      const found = channels.find(c => c.name === name);
      return found ? { id: found.id, name: found.name } : null;
    } catch (error) {
      console.error('[Slack] Error finding channel:', error);
      return null;
    }
  }

  /**
   * Format the initial task message
   */
  private formatTaskStartMessage(
    agentName: string,
    taskTitle: string,
    taskId: string,
    startedByUserId?: string
  ): string {
    const userMention = startedByUserId ? `<@${startedByUserId}>` : '';
    const greeting = startedByUserId
      ? `Hey ${userMention}! 👋\n\n`
      : '';

    return `${greeting}🤖 *Agent ${agentName}* is starting work on this task

*Task:* ${taskTitle}
*Task ID:* \`${taskId}\`
*Status:* In Progress
${startedByUserId ? `*Requested by:* ${userMention}` : ''}

---
Use this channel to communicate with the agent about this task.
• Ask questions about progress
• Provide additional context
• Request updates

The agent will post updates here as work progresses.`;
  }

  /**
   * Sanitize channel name for Slack
   */
  private sanitizeChannelName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 80);
  }

  /**
   * Make a Slack API call
   */
  private async apiCall(method: string, body: Record<string, unknown>): Promise<SlackResponse> {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return response.json() as Promise<SlackResponse>;
  }
}

export const slackService = new SlackService();
