const { app, startServer } = require('./server');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const taskManager = require('./automation/taskManager');
const { runAutomation } = require('./automation/browser');
const { searchPolicies, recommendPoliciesForUser } = require('./crawler/db');
const { getUser } = require('./crawler/user_db');

const server = new Server({
  name: "kakao-admin-assistant-mcp",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "start_application",
        description: "Starts the Kakao loan application process using headless browser automation.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Applicant name (e.g. 홍길동)" },
            email: { type: "string", description: "Applicant email" },
            amount: { type: "number", description: "Loan amount" }
          },
          required: ["name", "email", "amount"]
        }
      },
      {
        name: "check_status",
        description: "Checks the status of an application task. Use this to poll for PAUSED_SECURITY status.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "The task ID returned from start_application" }
          },
          required: ["taskId"]
        }
      },
      {
        name: "resume_application",
        description: "Resumes the application by submitting a Captcha code when the task is PAUSED_SECURITY.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            captchaCode: { type: "string" }
          },
          required: ["taskId", "captchaCode"]
        }
      },
      {
        name: "search_policies",
        description: "Searches for government support policies crawled from public APIs and websites.",
        inputSchema: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "Search keyword (e.g. 전월세, 소상공인)" },
            category: { type: "string", description: "Category filter (e.g. 대출, 취업/사업, 부동산)" }
        }
      },
      {
        name: "get_recommendations",
        description: "Gets personalized proactive policy recommendations for a specific user.",
        inputSchema: {
          type: "object",
          properties: {
            userId: { type: "string", description: "The ID of the user (e.g. user_1)" }
          },
          required: ["userId"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "start_application") {
    const taskId = `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { name, email, amount } = request.params.arguments;
    taskManager.createTask(taskId, { name, email, amount });
    
    // Trigger automation asynchronously
    runAutomation(taskId, process.env.PORT || 3000).catch(err => {
      console.error('Automation error in MCP tool:', err);
    });

    return {
      content: [{ type: "text", text: `Application started successfully. Task ID: ${taskId}. Please use check_status to monitor the task and if it pauses for security, use resume_application with the captcha.` }]
    };
  } else if (request.params.name === "check_status") {
    const task = taskManager.getTask(request.params.arguments.taskId);
    if (!task) {
      return { content: [{ type: "text", text: `Task not found.`}], isError: true };
    }
    return { 
      content: [{ 
        type: "text", 
        text: JSON.stringify({ 
          status: task.status, 
          error: task.error, 
          currentUrl: task.currentUrl 
        }, null, 2) 
      }] 
    };
  } else if (request.params.name === "resume_application") {
    const { taskId, captchaCode } = request.params.arguments;
    const result = taskManager.resumeTask(taskId, captchaCode);
    if (!result.success) {
      return { content: [{ type: "text", text: JSON.stringify(result) }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } else if (request.params.name === "search_policies") {
    const { keyword, category } = request.params.arguments;
    const policies = searchPolicies(keyword, category);
    return { content: [{ type: "text", text: JSON.stringify(policies, null, 2) }] };
  } else if (request.params.name === "get_recommendations") {
    const { userId } = request.params.arguments;
    const user = getUser(userId);
    if (!user) {
      return { content: [{ type: "text", text: "User not found."}], isError: true };
    }
    const recommendations = recommendPoliciesForUser(user);
    return { content: [{ type: "text", text: JSON.stringify({ user, recommendations }, null, 2) }] };
  }
  
  throw new Error("Tool not found");
});

// SSE Endpoints for MCP
let transport;
app.get('/sse', async (req, res) => {
  transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
  console.log('MCP SSE Client connected');
});

app.post('/messages', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No active SSE connection");
  }
});

// If run directly, start the server
if (require.main === module) {
  const port = process.env.PORT || 3000;
  startServer(port).then(() => {
    console.log(`[MCP Server] Running on port ${port}`);
    console.log(`[MCP Server] SSE Endpoint available at: http://localhost:${port}/sse`);
  });
}

module.exports = { server, app, startServer };
