const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { SSEClientTransport } = require("@modelcontextprotocol/sdk/client/sse.js");

async function run() {
  const transport = new SSEClientTransport(new URL("http://localhost:3000/sse"));
  const client = new Client({
    name: "test-client",
    version: "1.0.0"
  }, {
    capabilities: {}
  });

  await client.connect(transport);
  console.log("Connected to MCP server");

  const tools = await client.listTools();
  console.log("Available tools:", tools.tools.map(t => t.name));

  console.log("Calling start_application...");
  const startResult = await client.callTool({
    name: "start_application",
    arguments: {
      name: "테스터",
      email: "test@example.com",
      amount: 50000
    }
  });
  console.log("Start Result:", startResult.content[0].text);

  const taskIdMatch = startResult.content[0].text.match(/Task ID: (task-\d+-\d+)/);
  if (taskIdMatch) {
    const taskId = taskIdMatch[1];
    console.log("Task ID is", taskId);
    
    // Poll status
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusResult = await client.callTool({
        name: "check_status",
        arguments: { taskId }
      });
      console.log("Status:", statusResult.content[0].text);
      if (statusResult.content[0].text.includes('PAUSED_SECURITY')) {
        console.log("Paused for security. Attempting to resume...");
        // Wait another second for captcha text to be available
        await new Promise(r => setTimeout(r, 1000));
        // We can't know the captcha code easily from the outside unless we fetch it
        // The mock server exposes /api/automation/captcha/:taskId with Bearer mock-secret-token-123
        const fetch = require('node-fetch') || globalThis.fetch;
        const res = await fetch(`http://localhost:3000/api/automation/captcha/${taskId}`, {
          headers: { 'Authorization': 'Bearer mock-secret-token-123' }
        });
        const { captcha } = await res.json();
        console.log("Fetched mock captcha:", captcha);
        
        const resumeResult = await client.callTool({
          name: "resume_application",
          arguments: { taskId, captchaCode: captcha }
        });
        console.log("Resume Result:", resumeResult.content[0].text);
        break;
      }
    }
    
    // Final check
    await new Promise(r => setTimeout(r, 4000));
    const finalStatus = await client.callTool({
      name: "check_status",
      arguments: { taskId }
    });
    console.log("Final Status:", finalStatus.content[0].text);
  }

  process.exit(0);
}

run().catch(console.error);
