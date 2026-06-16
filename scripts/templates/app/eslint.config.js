import aubron from "@aubron/eslint-config";

/**
 * Apps extend the shared @aubron correctness config by reference (same as every
 * package) and add Next's build output to the ignore list.
 */
export default [...aubron, { ignores: [".next/**", "next-env.d.ts"] }];
