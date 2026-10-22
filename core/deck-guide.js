// "How to make a deck": the sample CSV and the one line that differs between the signed-in site
// and the public copy (where a deck is kept). screens/deck-guide.js draws the page.

export const SAMPLE_NAME = 'sample-deck.csv';

// Term in the first column, definition in the second, a header row on top. A definition with a
// comma goes in double quotes, which spreadsheets add on their own when saving as CSV.
export const SAMPLE_CSV = [
  'Term,Definition',
  'Amazon Bedrock,Fully managed service that gives access to foundation models from several providers through one API',
  'Amazon SageMaker,"Service to build, train and deploy your own machine learning models"',
  'Prompt engineering,"Shaping a model\'s input, such as instructions and examples, to get better output without retraining"',
  'Hallucination,A model states something false or made up as if it were fact',
].join('\n') + '\n';

export const SAMPLE_MD_NAME = 'sample-deck.md';

// The same four cards for people who keep notes in Markdown: a heading names the deck, then one
// **Term**: definition per line.
export const SAMPLE_MD = [
  '# Sample deck',
  '',
  '**Amazon Bedrock**: Fully managed service that gives access to foundation models from several providers through one API',
  '**Amazon SageMaker**: Service to build, train and deploy your own machine learning models',
  '**Prompt engineering**: Shaping a model\'s input, such as instructions and examples, to get better output without retraining',
  '**Hallucination**: A model states something false or made up as if it were fact',
].join('\n') + '\n';

export function whereDecksLive(local) {
  return local
    ? 'Your deck is kept in this browser only, with your progress. It is never uploaded anywhere. Clearing the browser\'s data or Reset all progress removes it, so keep the file.'
    : 'Your deck is saved to your account and shows up on all your signed-in devices.';
}

// A prompt to paste into Claude or another AI chat tool. It asks for exactly what the reader takes;
// the reader also copes with the code block and any chat around it, so the reply can be pasted whole.
export const AI_PROMPT = `Make flashcards for my study app as a CSV file.

Topic: [describe the topic, or paste your notes here]

Rules:
- First row exactly: Term,Definition
- Then one card per row: the term, a comma, the definition.
- Put double quotes around any field that contains a comma. Write a double quote inside a field as two double quotes ("").
- No line breaks inside a field, no blank rows, no numbering, no extra columns.
- Terms: a few words. Definitions: one plain sentence, under 200 characters.
- Write the definitions in your own words, and only include facts you are sure of.
- Reply with only the CSV in one code block.`;
