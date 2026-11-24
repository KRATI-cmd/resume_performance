// Importing the library entry directly avoids pdf-parse's index.js debug block,
// which tries to read a bundled test PDF when the module has no parent.
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdf from 'pdf-parse';
  export default pdf;
}
