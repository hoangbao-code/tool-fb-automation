# Add project specific ProGuard rules here.
-keep class com.zalotofb.poster.data.models.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
