import { NextRequest } from "next/server";
import OpenAI from 'openai';
import type { ChartData } from "@/types/chart";

// Initialize OpenAI client with correct headers
const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
});

export const runtime = "edge";

// Helper to validate base64
const isValidBase64 = (str: string) => {
  try {
    return btoa(atob(str)) === str;
  } catch (err) {
    return false;
  }
};

// Add Type Definitions
interface ChartToolResponse extends ChartData {
  // Any additional properties specific to the tool response
}

// Updated Tool Definition
const tools = [
  {
    type: "function",
    function: {
      name: "generate_graph_data",
      description: "Generate structured JSON data for creating financial charts and graphs.",
      parameters: {
        type: "object" as const,
        properties: {
          chartType: {
            type: "string" as const,
            enum: [
              "bar",
              "multiBar",
              "line",
              "pie",
              "area",
              "stackedArea",
            ] as const,
            description: "The type of chart to generate"
          },
          config: {
            type: "object" as const,
            properties: {
              title: { type: "string" as const },
              description: { type: "string" as const },
              trend: {
                type: "object" as const,
                properties: {
                  percentage: { type: "number" as const },
                  direction: {
                    type: "string" as const,
                    enum: ["up", "down"] as const,
                  },
                },
                required: ["percentage", "direction"],
              },
              footer: { type: "string" as const },
              totalLabel: { type: "string" as const },
              xAxisKey: { type: "string" as const },
            },
            required: ["title", "description"],
          },
          data: {
            type: "array" as const,
            items: {
              type: "object" as const,
              additionalProperties: true, // Allow any structure
            },
          },
          chartConfig: {
            type: "object" as const,
            additionalProperties: {
              type: "object" as const,
              properties: {
                label: { type: "string" as const },
                stacked: { type: "boolean" as const },
              },
              required: ["label"],
            },
          },
        },
        required: ["chartType", "config", "data", "chartConfig"],
      },
    }
  }
];

export async function POST(req: NextRequest) {
  try {
    const { messages, fileData, model } = await req.json();

    console.log("🔍 Initial Request Data:", {
      hasMessages: !!messages,
      messageCount: messages?.length,
      hasFileData: !!fileData,
      fileType: fileData?.mediaType,
      model,
    });

    // Input validation
    if (!messages || !Array.isArray(messages)) {
      console.log("⚠️ Error: Messages array is missing or invalid.");
      return new Response(
        JSON.stringify({ error: "Messages array is required" }),
        { status: 400 },
      );
    }

    if (!model) {
      console.log("⚠️ Error: Model selection is missing.");
      return new Response(
        JSON.stringify({ error: "Model selection is required" }),
        { status: 400 },
      );
    }

    // Convert all previous messages
    console.log("🔄 Converting previous messages...");
    let openaiMessages = messages.map((msg: any) => {
      console.log(`Message Role: ${msg.role}, Content: ${msg.content}`);
      return {
        role: msg.role,
        content: msg.content,
      };
    });

    // Handle file in the latest message
    if (fileData) {
      const { base64, mediaType, isText } = fileData;
      console.log(`📂 Processing file data, MediaType: ${mediaType}, IsText: ${isText}`);

      if (!base64) {
        console.error("❌ No base64 data received");
        return new Response(JSON.stringify({ error: "No file data" }), {
          status: 400,
        });
      }

      try {
        if (isText) {
          console.log("✏️ Processing as text file...");
          const textContent = decodeURIComponent(escape(atob(base64)));
          console.log(`Decoded Text Content: ${textContent.slice(0, 100)}...`);

          openaiMessages[openaiMessages.length - 1] = {
            role: "user",
            content: `File contents of ${fileData.fileName}:\n\n${textContent}\n\n${messages[messages.length - 1].content}`,
          };
        } else if (mediaType.startsWith("image/")) {
          console.log("🖼️ Processing as image file...");
          openaiMessages[openaiMessages.length - 1] = {
            role: "user",
            content: {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64,
              },
            }
          };
        }
      } catch (error) {
        console.error("Error processing file content:", error);
        return new Response(
          JSON.stringify({ error: "Failed to process file content" }),
          { status: 400 },
        );
      }
    }

    console.log("🚀 Final OpenAI API Request:", {
      model,
      max_tokens: 4096,
      temperature: 0.7,
      messageCount: openaiMessages.length,
      tools: tools.map((t) => t.function.name),
      messageStructure: JSON.stringify(
        openaiMessages.map((msg) => ({
          role: msg.role,
          content:
            typeof msg.content === "string"
              ? msg.content.slice(0, 50) + "..."
              : "[Complex Content]",
        })),
        null,
        2,
      ),
    });

    const response = await openai.chat.completions.create({
      model,
      max_tokens: 16384,
      temperature: 0.7,
      tools: tools,
      messages: [
        { role: "system", content: `You are a financial data visualization expert. Your role is to analyze financial data and create clear, meaningful visualizations using generate_graph_data tool:

Here are the chart types available and their ideal use cases:

1. LINE CHARTS ("line")
   - Time series data showing trends
   - Financial metrics over time
   - Market performance tracking

2. BAR CHARTS ("bar")
   - Single metric comparisons
   - Period-over-period analysis
   - Category performance

3. MULTI-BAR CHARTS ("multiBar")
   - Multiple metrics comparison
   - Side-by-side performance analysis
   - Cross-category insights

4. AREA CHARTS ("area")
   - Volume or quantity over time
   - Cumulative trends
   - Market size evolution

5. STACKED AREA CHARTS ("stackedArea")
   - Component breakdowns over time
   - Portfolio composition changes
   - Market share evolution

6. PIE CHARTS ("pie")
   - Distribution analysis
   - Market share breakdown
   - Portfolio allocation

When generating visualizations:
1. Structure data correctly based on the chart type
2. Use descriptive titles and clear descriptions
3. Include trend information when relevant (percentage and direction)
4. Add contextual footer notes
5. Use proper data keys that reflect the actual metrics

Data Structure Examples:

For Time-Series (Line/Bar/Area):
{
  data: [
    { period: "Q1 2024", revenue: 1250000 },
    { period: "Q2 2024", revenue: 1450000 }
  ],
  config: {
    xAxisKey: "period",
    title: "Quarterly Revenue",
    description: "Revenue growth over time"
  },
  chartConfig: {
    revenue: { label: "Revenue ($)" }
  }
}

For Comparisons (MultiBar):
{
  data: [
    { category: "Product A", sales: 450000, costs: 280000 },
    { category: "Product B", sales: 650000, costs: 420000 }
  ],
  config: {
    xAxisKey: "category",
    title: "Product Performance",
    description: "Sales vs Costs by Product"
  },
  chartConfig: {
    sales: { label: "Sales ($)" },
    costs: { label: "Costs ($)" }
  }
}

For Distributions (Pie):
{
  data: [
    { segment: "Equities", value: 5500000 },
    { segment: "Bonds", value: 3200000 }
  ],
  config: {
    xAxisKey: "segment",
    title: "Portfolio Allocation",
    description: "Current investment distribution",
    totalLabel: "Total Assets"
  },
  chartConfig: {
    equities: { label: "Equities" },
    bonds: { label: "Bonds" }
  }
}

Always:
- Generate real, contextually appropriate data
- Use proper financial formatting
- Include relevant trends and insights
- Structure data exactly as needed for the chosen chart type
- Choose the most appropriate visualization for the data

Never:
- Use placeholder or static data
- Announce the tool usage
- Include technical implementation details in responses
- NEVER SAY you are using the generate_graph_data tool, just execute it when needed.

Focus on clear financial insights and let the visualization enhance understanding.`
        },
        ...openaiMessages
      ],
    });

    console.log("📝 Full OpenAI API Response:", response);
    console.log("✅ Processed OpenAI API Response Details:", {
      status: "success",
      stopReason: response.choices[0].finish_reason,
    });

    const toolCall = response.choices[0]?.message.tool_calls?.[0];
    const textContent = response.choices[0]?.message.content || "";

    // 打印收到的工具调用信息
    console.log("📥 Received tool call:", JSON.stringify(toolCall, null, 2));
    console.log("📥 Received text content:", textContent);

    // 如果有工具调用则进行处理
    const processToolResponse = (toolCall: any) => {
      if (!toolCall) {
        console.log("⚠️ No tool call to process.");
        return null;
      }

      // 解析工具输入
      const toolInput = JSON.parse(toolCall.function.arguments);
      const chartData = toolInput as ChartToolResponse;

      // 打印解析的工具输入和详细 chartData 内容
      console.log("🔍 Parsed tool input:", JSON.stringify(toolInput, null, 2));
      console.log("🔍 Detailed chartData content:", JSON.stringify(chartData, null, 2));

      // 验证基本的chartData结构并细化错误信息
      if (!chartData.chartType) {
        console.log("❌ Error: Missing 'chartType' in chartData!");
        throw new Error("Invalid chart data structure: Missing 'chartType'");
      }

      if (!chartData.data) {
        console.log("❌ Error: 'data' is undefined or null in chartData!");
        throw new Error("Invalid chart data structure: 'data' is undefined or null");
      }

      if (!Array.isArray(chartData.data)) {
        console.log("❌ Error: 'data' should be an array in chartData, but got:", typeof chartData.data);
        throw new Error("Invalid chart data structure: 'data' is not an array");
      }

      console.log(`🔧 Transforming data for chart type: ${chartData.chartType}`);
      console.log("🔧 Chart data before transformation:", JSON.stringify(chartData, null, 2));
      // Transform data for pie charts to match expected structure
      if (chartData.chartType === "pie") {
        chartData.data = chartData.data.map((item) => {
          const valueKey = Object.keys(chartData.chartConfig)[0];
          const segmentKey = chartData.config.xAxisKey || "segment";

          const transformedItem = {
            segment: item[segmentKey] || item.segment || item.category || item.name,
            value: item[valueKey] || item.value,
          };
          console.log("🔄 Transformed item:", transformedItem);
          return transformedItem;
        });

        chartData.config.xAxisKey = "segment";
      }

      const processedChartConfig = Object.entries(chartData.chartConfig).reduce(
        (acc, [key, config], index) => {
          const colorConfig = {
            ...acc,
            [key]: {
              ...config,
              color: `hsl(var(--chart-${index + 1}))`,
            },
          };
          console.log("🎨 Processed chart config for key:", key, colorConfig);
          return colorConfig;
        },
        {},
      );

      return {
        ...chartData,
        chartConfig: processedChartConfig,
      };
    };

    const processedChartData = toolCall
      ? processToolResponse(toolCall)
      : null;

    console.log("🔜 Returning processed response...");
    return new Response(
      JSON.stringify({
        content: textContent,
        toolUse: toolCall ? processToolResponse(toolCall) : null,
        chartData: processedChartData,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      },
    );
  } catch (error) {
    console.error("❌ Finance API Error: ", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "An unknown error occurred",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
