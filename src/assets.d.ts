// Image imports resolve to the URL of the bundled (content-hashed) file.
declare module '*.png' {
  const url: string;
  export default url;
}
