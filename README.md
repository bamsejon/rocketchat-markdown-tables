# Rocket.Chat Markdown Tables

A Rocket.Chat App that adds markdown table support by rendering tables as formatted ASCII tables in code blocks.

## Features

- Parses GitHub Flavored Markdown (GFM) tables
- **Paste from Excel/Sheets** - Tab-separated data is automatically converted to tables
- Renders beautiful ASCII box-drawing tables
- Supports column alignment (left, center, right)
- Handles emojis correctly (proper column width calculation)
- Works with any number of columns and rows

## Installation

### Quick Install (Recommended)

1. **Download** the latest release from [Releases](https://github.com/bamsejon/rocketchat-markdown-tables/releases)

2. **Enable Apps in Rocket.Chat:**
   - Log in as administrator
   - Go to **Administration** (gear icon) → **Settings** → **General** → **Apps**
   - Set **Enable the App Framework** to `True`
   - Set **Enable development mode** to `True` (required for private apps)
   - Click **Save changes**

3. **Install the App:**
   - Go to **Administration** → **Apps** → **Private Apps**
   - Click **Upload App**
   - Select the downloaded `.zip` file
   - Click **Install**
   - When prompted, click **Agree** to accept permissions

4. **Verify Installation:**
   - The app should now show as "Enabled" in Private Apps
   - Try sending a message with a markdown table to test!

### Build from Source

```bash
# Clone the repository
git clone https://github.com/bamsejon/rocketchat-markdown-tables.git
cd rocketchat-markdown-tables

# Install dependencies
npm install

# Build the app
npm run build

# The zip file will be created in dist/
```

## Usage

### Markdown Tables

Write standard markdown tables in your messages:

```markdown
| Name    | Age | City      |
|---------|-----|-----------|
| Alice   | 30  | Stockholm |
| Bob     | 25  | Göteborg  |
```

The app converts this to a formatted ASCII table:

```
┌─────────┬───────┬───────────┐
│ Name    │ Age   │ City      │
├─────────┼───────┼───────────┤
│ Alice   │ 30    │ Stockholm │
│ Bob     │ 25    │ Göteborg  │
└─────────┴───────┴───────────┘
```

### Paste from Excel/Spreadsheets

Copy cells from Excel, Google Sheets, or any spreadsheet and paste directly into Rocket.Chat. The tab-separated data is automatically converted to a table!

```
Name    Age    City           →    Becomes a formatted table!
Alice   30     Stockholm
Bob     25     Göteborg
```

### Column Alignment

The app supports standard GFM alignment syntax:

```markdown
| Left-aligned | Center-aligned | Right-aligned |
|:-------------|:--------------:|--------------:|
| Left         |    Center      |         Right |
```

## Requirements

- Rocket.Chat 6.0 or newer
- Apps Framework enabled
- Administrator access for installation

## Troubleshooting

### App doesn't appear after upload
- Make sure **Enable development mode** is set to `True` in Settings → General → Apps
- Try refreshing the page after enabling

### Tables not rendering
- Check that the app is enabled in Administration → Apps → Private Apps
- Verify the app status shows "Enabled"
- Make sure your table has the separator row (e.g., `|---|---|`)

### Permission errors
- Ensure you're logged in as an administrator
- The app requires `message.read` and `message.write` permissions

## License

MIT

## Author

bamsejon - https://github.com/bamsejon
