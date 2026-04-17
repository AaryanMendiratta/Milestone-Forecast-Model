// Simple syntax check - try to parse the file
const fs = require('fs');
const path = require('path');

try {
  const filePath = path.join(__dirname, 'src', 'MetricDependencies.jsx');
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Count braces
  const openBraces = (content.match(/{/g) || []).length;
  const closeBraces = (content.match(/}/g) || []).length;
  
  console.log(`Open braces: ${openBraces}`);
  console.log(`Close braces: ${closeBraces}`);
  
  if (openBraces === closeBraces) {
    console.log('✓ Brace count matches!');
  } else {
    console.log('✗ Brace mismatch!');
  }
  
  // Check for export default
  if (content.includes('export default function MetricDependencies()')) {
    console.log('✓ Export default found!');
  } else {
    console.log('✗ Export default missing!');
  }
  
} catch (err) {
  console.error('Error:', err.message);
}
