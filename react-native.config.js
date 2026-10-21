module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: "./android",
        packageImportPath:
          "import com.appinstall.reactnative.AppInstallPackage;",
        packageInstance: "new AppInstallPackage()",
      },
      // The CLI discovers the root podspec; podspecPath is not a dependency input option.
      ios: {},
    },
  },
};
