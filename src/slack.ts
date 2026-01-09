/**
 * Slack Integration
 * Creates channels for agent-task communication
 */

interface SlackChannel {
  id: string;
  name: string;
}

interface SlackResponse {
  ok: boolean;
  channel?: SlackChannel;
  error?: string;
}

export class SlackService {
  private token: string | null = null;
  private defaultChannelId: string | null = null;

  constructor() {
    this.token = process.env.SLACK_BOT_TOKEN || null;
    this.defaultChannelId = process.env.SLACK_CHANNEL_ID || null;

    if (this.token) {
      console.log('[Slack] Service initialized');
    } else {
      console.log('[Slack] No SLACK_BOT_TOKEN, Slack features disabled');
    }
  }

  isEnabled(): boolean {
    return this.token !== null;
  }

  /**
   * Create a channel for an agent task
   * Channel name format: task-{agentName}-{taskId}
   */
  async createTaskChannel(
    agentName: string,
    taskId: string,
    taskTitle: string
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
          return existingChannel;
        }
        console.error('[Slack] Failed to create channel:', createResponse.error);
        return null;
      }

      const channel = createResponse.channel as SlackChannel;
      console.log(`[Slack] Created channel: #${channelName}`);

      // Post initial message with task context
      await this.postMessage(channel.id, this.formatTaskStartMessage(agentName, taskTitle, taskId));

      return channel;
    } catch (error) {
      console.error('[Slack] Error creating channel:', error);
      return null;
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
  private formatTaskStartMessage(agentName: string, taskTitle: string, taskId: string): string {
    return `🤖 *Agent ${agentName}* is starting work on this task

*Task:* ${taskTitle}
*Task ID:* \`${taskId}\`
*Status:* In Progress

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
