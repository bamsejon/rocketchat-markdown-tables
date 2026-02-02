# Rocket.Chat Markdown Tables

A Rocket.Chat App that adds markdown table support by converting GFM-style tables to formatted message attachments.

## Features

- Parses GitHub Flavored Markdown (GFM) tables
- Converts tables to Rocket.Chat message attachments with fields
- Supports column alignment (left, center, right)
- Works with any number of columns and rows
- Preserves other message content

## Installation

### From Marketplace (Recommended)

1. Go to **Administration** → **Marketplace** → **Private Apps**
2. Upload the `.zip` file

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/bamsejon/rocketchat-markdown-tables.git
cd rocketchat-markdown-tables

# Install dependencies
npm install

# Build the app
npm run build

# Deploy to your Rocket.Chat instance
export RC_URL="https://your-rocketchat.example.com"
export RC_USER="admin-username"
export RC_PASS="admin-password"
npm run deploy
```

## Usage

Simply write markdown tables in your messages:

```markdown
| Name    | Age | City      |
|---------|-----|-----------|
| Alice   | 30  | Stockholm |
| Bob     | 25  | Göteborg  |
| Charlie | 35  | Malmö     |
```

The app will automatically convert this to a formatted attachment with fields.

## Table Syntax

The app supports standard GFM table syntax:

```markdown
| Left-aligned | Center-aligned | Right-aligned |
|:-------------|:--------------:|--------------:|
| Left         | Center         | Right         |
```

## Mattermost-like Styling (Optional CSS)

To make Rocket.Chat look more like Mattermost, add this CSS in **Administration** → **Settings** → **Layout** → **Custom CSS**:

```css
/* Mattermost-like styling */

/* Sidebar */
.sidebar {
    background-color: #1e325c !important;
}

.sidebar-item:hover {
    background-color: #28427b !important;
}

/* Message styling */
.message {
    padding: 8px 16px !important;
    border-bottom: 1px solid #e0e0e0 !important;
}

/* Username styling */
.message .user-card-message {
    font-weight: 600 !important;
    color: #3d3c40 !important;
}

/* Attachment table fields */
.attachment-fields {
    display: grid !important;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)) !important;
    gap: 8px !important;
}

.attachment-field {
    background: #f8f8f8 !important;
    padding: 8px !important;
    border-radius: 4px !important;
    border-left: 3px solid #4A90A4 !important;
}

.attachment-field-title {
    font-weight: 600 !important;
    color: #1e325c !important;
    margin-bottom: 4px !important;
}
```

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- Rocket.Chat Apps CLI (`npm install -g @rocket.chat/apps-cli`)

### Building

```bash
npm install
npm run build
```

This creates a `.zip` file that can be uploaded to Rocket.Chat.

### Testing locally

1. Enable Apps development mode in Rocket.Chat:
   - Go to **Administration** → **General** → **Apps**
   - Enable "Enable development mode"

2. Deploy the app:
   ```bash
   rc-apps deploy --url http://localhost:3000 --username admin --password admin
   ```

## Architecture

The app uses the `IPreMessageSentModify` hook to intercept messages before they are saved:

1. **Check phase**: `checkPreMessageSentModify` - Quick check if message contains potential tables
2. **Modify phase**: `executePreMessageSentModify` - Parse tables and convert to attachments

### Table Parser

The `lib/tableParser.ts` module handles GFM table parsing:

- `parseMarkdownTable(text)` - Extract all tables from text
- `TableData` interface - Structured table representation with headers, rows, and alignments

## License

MIT

## Author

bamsejon - https://github.com/bamsejon
