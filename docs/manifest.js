window.DOJO_MEDIA = {
  "title": "CopilotKit + Copilot SDK: interactive agent demos",
  "provider": {
    "backend": "Python Copilot SDK",
    "frontend": "TypeScript / React + CopilotKit",
    "model": "Claude Sonnet 5",
    "host": "Foundry"
  },
  "demos": [
    {
      "id": "agentic_chat",
      "title": "Streaming conversation",
      "summary": "A real model response arrives incrementally in the chat.",
      "prompts": [
        "Explain why streaming responses are useful in a chat interface. Write exactly eight numbered points, about 20 words each, and a one-sentence conclusion."
      ],
      "chapters": [
        {
          "time": 1.0,
          "label": "Ready"
        },
        {
          "time": 1.04,
          "label": "Prompt 1"
        },
        {
          "time": 4.427,
          "label": "Send to live model"
        },
        {
          "time": 12.162,
          "label": "Final result"
        }
      ],
      "src": "clips/agentic_chat.mp4",
      "poster": "posters/agentic_chat.jpg",
      "duration": 17.48,
      "insight": "The user sees the answer while the model is still responding."
    },
    {
      "id": "backend_tool_rendering",
      "title": "Backend tools, visible results",
      "summary": "Two weather tool calls become application-defined cards.",
      "prompts": [
        "What is the weather in San Francisco? Use the weather tool.",
        "Now show the weather in New York using the weather tool."
      ],
      "chapters": [
        {
          "time": 1.0,
          "label": "Ready"
        },
        {
          "time": 1.0030000000000001,
          "label": "Prompt 1"
        },
        {
          "time": 3.042,
          "label": "Send to live model"
        },
        {
          "time": 7.336,
          "label": "First weather card"
        },
        {
          "time": 9.434999999999999,
          "label": "Prompt 2"
        },
        {
          "time": 11.361,
          "label": "Send to live model"
        },
        {
          "time": 14.959,
          "label": "Final result"
        }
      ],
      "src": "clips/backend_tool_rendering.mp4",
      "poster": "posters/backend_tool_rendering.jpg",
      "duration": 20.24,
      "insight": "A real get_weather call returns data; the application renders the card."
    },
    {
      "id": "human_in_the_loop",
      "title": "A plan you can change",
      "summary": "Deselect a proposed step, confirm the rest, and resume the original tool call.",
      "prompts": [
        "Propose exactly three independent steps for a workshop: prepare name badges, arrange the chairs, and test the projector. Use the task planner, then wait. After I confirm, count the steps in the returned approval result and summarize only those, beginning 'Approved plan: N steps'. Do not ask me to review again or claim to execute them."
      ],
      "chapters": [
        {
          "time": 0,
          "label": "Prompt entry; leading pre-roll trimmed"
        },
        {
          "time": 2.088,
          "label": "Send to live model"
        },
        {
          "time": 7.029000000000001,
          "label": "Review the proposed plan"
        },
        {
          "time": 10.303,
          "label": "Deselect the badge step"
        },
        {
          "time": 10.346999999999998,
          "label": "Edited selection"
        },
        {
          "time": 13.611999999999998,
          "label": "Confirm selected steps"
        },
        {
          "time": 15.721,
          "label": "Final result"
        }
      ],
      "src": "clips/human_in_the_loop-v06-trimmed.mp4",
      "poster": "posters/human_in_the_loop-v06-trimmed.jpg",
      "duration": 21.56,
      "insight": "Three proposed. Two approved. The agent acknowledges only the two selected steps."
    },
    {
      "id": "tool_based_generative_ui",
      "title": "Swiss haikus, shaped by a tool",
      "summary": "Two Swiss-themed requests become distinct frontend-rendered haiku cards.",
      "prompts": [
        "Write a Swiss-themed haiku about the Matterhorn glowing at dusk. Use generate_haiku.",
        "Now create a different Swiss-themed haiku about Lake Lucerne at dawn. Use generate_haiku."
      ],
      "chapters": [
        {
          "time": 1.0,
          "label": "Ready"
        },
        {
          "time": 1.0020000000000002,
          "label": "Prompt 1"
        },
        {
          "time": 3.402,
          "label": "Send to live model"
        },
        {
          "time": 10.257,
          "label": "First haiku rendered"
        },
        {
          "time": 13.454,
          "label": "Prompt 2"
        },
        {
          "time": 16.095999999999997,
          "label": "Send to live model"
        },
        {
          "time": 42.539,
          "label": "Bounded follow-up observation"
        },
        {
          "time": 49.245000000000005,
          "label": "Final result"
        }
      ],
      "src": "clips/tool_based_generative_ui-v07.mp4",
      "poster": "posters/tool_based_generative_ui-v07.jpg",
      "duration": 57.8,
      "insight": "Ask for a Swiss-themed haiku; the agent updates the application canvas."
    },
    {
      "id": "shared_state",
      "title": "The agent sees your edit",
      "summary": "Generate a recipe, change its ingredients in the form, and ask the model what changed.",
      "prompts": [
        "Create a pasta recipe using generate_recipe; include an ingredient named exactly \"Pasta\".",
        "List the ingredients in the current recipe, including my manually added ingredient and its amount. Do not change the recipe."
      ],
      "chapters": [
        {
          "time": 1.0,
          "label": "Ready"
        },
        {
          "time": 1.0030000000000001,
          "label": "Prompt 1"
        },
        {
          "time": 3.587999999999999,
          "label": "Send to live model"
        },
        {
          "time": 12.253000000000002,
          "label": "Recipe populated"
        },
        {
          "time": 15.573000000000002,
          "label": "Add an ingredient in the form"
        },
        {
          "time": 15.748,
          "label": "UI edit Purple carrots 7"
        },
        {
          "time": 18.360999999999997,
          "label": "Prompt 2"
        },
        {
          "time": 21.503999999999998,
          "label": "Send to live model"
        },
        {
          "time": 24.223,
          "label": "Final result"
        }
      ],
      "src": "clips/shared_state.mp4",
      "poster": "posters/shared_state.jpg",
      "duration": 30.4,
      "insight": "The agent reads your form edit without you pasting it into chat."
    },
    {
      "id": "agentic_generative_ui",
      "title": "Progress in the application",
      "summary": "A task plan advances through committed state updates.",
      "prompts": [
        "Use the task planner to make a three-step plan for baking brownies and complete it."
      ],
      "chapters": [
        {
          "time": 1.0,
          "label": "Ready"
        },
        {
          "time": 1.0210000000000008,
          "label": "Prompt 1"
        },
        {
          "time": 3.3469999999999995,
          "label": "Send to live model"
        },
        {
          "time": 20.569,
          "label": "Final result"
        }
      ],
      "src": "clips/agentic_generative_ui.mp4",
      "poster": "posters/agentic_generative_ui.jpg",
      "duration": 26.4,
      "insight": "The application reflects committed progress instead of displaying only a text answer."
    },
    {
      "id": "predictive_state_updates",
      "title": "Preview. Approve. Keep control.",
      "summary": "Review a document, accept useful augmentations, and reject a change without losing accepted content.",
      "prompts": [
        "Use write_document to draft a 90-word welcome note for a fictional developer workshop in Zurich. Use two plain paragraphs. End exactly with: Bring your laptop.",
        "Use write_document to add a short third paragraph describing a hands-on agent UI lab. Keep every existing word unchanged, including Zurich and Bring your laptop.",
        "Use write_document to replace Zurich with Geneva everywhere. Leave every other word unchanged.",
        "Use write_document to add one final sentence: Bring an example workflow to explore. Preserve all accepted content and keep the workshop in Zurich."
      ],
      "chapters": [
        {
          "time": 0,
          "label": "Ask for an initial draft"
        },
        {
          "time": 13,
          "label": "First draft: no earlier document to compare"
        },
        {
          "time": 19,
          "label": "Initial draft accepted"
        },
        {
          "time": 31,
          "label": "Green highlight: new lab paragraph"
        },
        {
          "time": 38,
          "label": "Lab paragraph accepted"
        },
        {
          "time": 45,
          "label": "Red/green diff: Zurich to Geneva"
        },
        {
          "time": 50,
          "label": "Rejected: Zurich and prior paragraph retained"
        },
        {
          "time": 59,
          "label": "Green highlight: new closing sentence"
        },
        {
          "time": 66,
          "label": "Final addition accepted; earlier work retained"
        }
      ],
      "src": "clips/predictive_state_updates-v07.mp4",
      "poster": "posters/predictive_state_updates-v07.jpg",
      "duration": 73.92,
      "insight": "Preview highlighted changes, then accept or reject them without losing accepted content."
    },
    {
      "id": "agentic_chat_reasoning",
      "title": "A recommendation you can understand",
      "summary": "A compact comparison, one recommendation and a readable rationale.",
      "prompts": [
        "Choose a demo setup for tomorrow's workshop. Compare a local model (offline operation after setup, more setup effort) with a managed endpoint (network required, less setup effort). Show a compact two-row comparison, recommend one for fastest setup, and give a single-sentence rationale."
      ],
      "chapters": [
        {
          "time": 1.0,
          "label": "Ready"
        },
        {
          "time": 1.0069999999999997,
          "label": "Prompt 1"
        },
        {
          "time": 6.546,
          "label": "Send to live model"
        },
        {
          "time": 10.752,
          "label": "Final result"
        }
      ],
      "src": "clips/agentic_chat_reasoning-v07.mp4",
      "poster": "posters/agentic_chat_reasoning-v07.jpg",
      "duration": 15.52,
      "insight": "A concise recommendation should explain its criteria and trade-off."
    },
    {
      "id": "agentic_chat_multimodal",
      "title": "An image becomes an ASCII sketch",
      "summary": "The actual uploaded picture is visible alongside a compact visual reconstruction.",
      "prompts": [
        "Recreate the uploaded image with simple ASCII outlines in one fenced code block, at most 9 lines total. Underneath each outline, write a label naming its observed color AND shape. No explanatory paragraphs. If the image was not received, say so rather than guessing."
      ],
      "chapters": [
        {
          "time": 1.0,
          "label": "Ready"
        },
        {
          "time": 1.0030000000000001,
          "label": "Upload the actual image"
        },
        {
          "time": 1.0139999999999993,
          "label": "Image attached"
        },
        {
          "time": 6.1030000000000015,
          "label": "Prompt 1"
        },
        {
          "time": 7.167999999999999,
          "label": "Send to live model"
        },
        {
          "time": 10.018,
          "label": "Final result"
        }
      ],
      "src": "clips/agentic_chat_multimodal-v07.mp4",
      "poster": "posters/agentic_chat_multimodal-v07.jpg",
      "duration": 14.2,
      "insight": "Compare the actual uploaded picture with the model's visual reconstruction.",
      "inputImage": {
        "src": "assets/vision-shapes-v07.png",
        "alt": "Actual uploaded input: red square on the left, blue circle on the right.",
        "label": "Actual image uploaded in this recording"
      }
    },
    {
      "id": "interrupt",
      "title": "Choose a time, or cancel",
      "summary": "A meeting picker pauses the agent for a selection or cancellation.",
      "prompts": [
        "Book an intro call with the sales team to discuss pricing.",
        "Book another intro call with the sales team about enterprise pricing."
      ],
      "chapters": [
        {
          "time": 1.0,
          "label": "Ready"
        },
        {
          "time": 1.0030000000000001,
          "label": "Prompt 1"
        },
        {
          "time": 2.9100000000000006,
          "label": "Send to live model"
        },
        {
          "time": 5.2669999999999995,
          "label": "Review sample time slots"
        },
        {
          "time": 8.492,
          "label": "Choose a sample slot"
        },
        {
          "time": 10.269,
          "label": "First tool resumed"
        },
        {
          "time": 12.363000000000001,
          "label": "Prompt 2"
        },
        {
          "time": 14.476,
          "label": "Send to live model"
        },
        {
          "time": 16.813000000000002,
          "label": "Previously chosen slot is unavailable"
        },
        {
          "time": 21.044,
          "label": "Cancel the second request"
        },
        {
          "time": 23.126,
          "label": "Final result"
        }
      ],
      "src": "clips/interrupt-v07.mp4",
      "poster": "posters/interrupt-v07.jpg",
      "duration": 28.68,
      "insight": "Choose a slot once. It is no longer offered on the next request in the same session."
    },
    {
      "id": "deepagents_subagents",
      "title": "Delegation you can follow",
      "summary": "A native research child asks for approval, resumes, and returns its answer through the supervisor.",
      "prompts": [
        "Why is the sky blue?"
      ],
      "chapters": [
        {
          "time": 1.0,
          "label": "Ready"
        },
        {
          "time": 1.0030000000000001,
          "label": "Prompt 1"
        },
        {
          "time": 2.5840000000000014,
          "label": "Send to live model"
        },
        {
          "time": 8.309,
          "label": "Inspect native child attribution"
        },
        {
          "time": 8.470999999999998,
          "label": "Child awaits human approval"
        },
        {
          "time": 12.88,
          "label": "Approve the child answer"
        },
        {
          "time": 17.665,
          "label": "Final result"
        }
      ],
      "src": "clips/deepagents_subagents.mp4",
      "poster": "posters/deepagents_subagents.jpg",
      "duration": 23.04,
      "insight": "Your approval resumes the same child; the supervisor returns its answer."
    },
    {
      "id": "subgraphs",
      "title": "Three travel specialists",
      "summary": "Native flight, hotel and experience specialists work together on an itinerary.",
      "prompts": [
        "Help me plan a trip from Amsterdam to San Francisco using the demo itinerary."
      ],
      "chapters": [
        {
          "time": 1.0,
          "label": "Ready"
        },
        {
          "time": 1.0040000000000013,
          "label": "Prompt 1"
        },
        {
          "time": 4.025000000000002,
          "label": "Send to live model"
        },
        {
          "time": 13.082,
          "label": "Flight specialist offers choices"
        },
        {
          "time": 16.507,
          "label": "Choose KLM"
        },
        {
          "time": 26.463,
          "label": "Hotel specialist offers choices"
        },
        {
          "time": 29.79,
          "label": "Choose Hotel Zoe"
        },
        {
          "time": 43.015,
          "label": "Final result"
        }
      ],
      "src": "clips/subgraphs.mp4",
      "poster": "posters/subgraphs.jpg",
      "duration": 51.6,
      "insight": "Your chosen flight and hotel survive the specialist handoffs."
    }
  ],
  "mix": {
    "src": "mix/highlights-v10.mp4",
    "silentSrc": "mix/highlights-silent-v10.mp4",
    "poster": "posters/highlights-v10.jpg",
    "duration": 170.72,
    "chapters": [
      {
        "time": 0.0,
        "label": "Introduction"
      },
      {
        "time": 10.0,
        "label": "Start with streaming"
      },
      {
        "time": 22.4,
        "label": "The agent proposes. You decide."
      },
      {
        "time": 42.4,
        "label": "It sees what you changed"
      },
      {
        "time": 55.599999999999994,
        "label": "1. Approve a highlighted addition"
      },
      {
        "time": 63.599999999999994,
        "label": "2. Reject a change. Keep your document."
      },
      {
        "time": 71.6,
        "label": "3. Approve another highlighted addition"
      },
      {
        "time": 80.6,
        "label": "See the tool behind the card"
      },
      {
        "time": 91.11999999999999,
        "label": "Show it. Ask for a visual answer."
      },
      {
        "time": 104.11999999999999,
        "label": "Make a choice, then resume"
      },
      {
        "time": 108.11999999999999,
        "label": "That slot is no longer offered"
      },
      {
        "time": 114.71999999999998,
        "label": "Approve delegated work"
      },
      {
        "time": 125.71999999999998,
        "label": "Native handoff: flights to hotels"
      },
      {
        "time": 138.23999999999998,
        "label": "Native handoff: hotels to experiences"
      },
      {
        "time": 149.23999999999998,
        "label": "One itinerary, three native specialists"
      },
      {
        "time": 154.71999999999997,
        "label": "Pick a pattern. Make it yours."
      }
    ],
    "title": "Highlight mix · 2:50",
    "cuts": [
      {
        "label": "Introduction"
      },
      {
        "feature": "agentic_chat",
        "label": "Start with streaming"
      },
      {
        "feature": "human_in_the_loop",
        "label": "The agent proposes. You decide."
      },
      {
        "feature": "shared_state",
        "label": "It sees what you changed"
      },
      {
        "feature": "predictive_state_updates",
        "label": "1. Approve a highlighted addition"
      },
      {
        "feature": "predictive_state_updates",
        "label": "2. Reject a change. Keep your document."
      },
      {
        "feature": "predictive_state_updates",
        "label": "3. Approve another highlighted addition"
      },
      {
        "feature": "backend_tool_rendering",
        "label": "See the tool behind the card"
      },
      {
        "feature": "agentic_chat_multimodal",
        "label": "Show it. Ask for a visual answer."
      },
      {
        "feature": "interrupt",
        "label": "Make a choice, then resume"
      },
      {
        "feature": "interrupt",
        "label": "That slot is no longer offered"
      },
      {
        "feature": "deepagents_subagents",
        "label": "Approve delegated work"
      },
      {
        "feature": "subgraphs",
        "label": "Native handoff: flights to hotels"
      },
      {
        "feature": "subgraphs",
        "label": "Native handoff: hotels to experiences"
      },
      {
        "feature": "subgraphs",
        "label": "One itinerary, three native specialists"
      },
      {
        "label": "Pick a pattern. Make it yours."
      }
    ]
  }
};
